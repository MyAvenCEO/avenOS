use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use aven_voice_core::{MonoTimeNs, Observation, RouteGeneration, VoiceConfigV1};
use aven_voice_protocol::{CandidateId, EchoStatus, SessionId};
use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};

use crate::{
    AudioFrame48k, CapturePort, ClockAligner, ClockFault, EchoProcessor, InputModelEvent,
    InputProcessor, ProcessingFormat, RenderPort, RuntimeObserver, StreamingRecognizer,
    StreamingSincResampler, TimestampQuality, VoiceActivityDetector, ASR_RATE_HZ,
    MAX_CALLBACK_SAMPLES, PROCESSING_FRAME_SAMPLES, PROCESSING_RATE_HZ,
};

const CLEAN_QUEUE_FRAMES: usize = 64;
const MAX_RESAMPLED_SAMPLES: usize = MAX_CALLBACK_SAMPLES * 8;

#[derive(Clone, Default)]
pub struct DuplexMetrics(Arc<DuplexMetricsInner>);

struct DuplexMetricsInner {
    delay_hint_ms: AtomicU32,
    drift_correction_ppm: AtomicU32,
    render_rms: AtomicU32,
    render_peak: AtomicU32,
    raw_rms: AtomicU32,
    raw_peak: AtomicU32,
    clean_rms: AtomicU32,
    clean_peak: AtomicU32,
    clipped_fraction: AtomicU32,
    max_clipped_fraction: AtomicU32,
    echo_return_loss_db: AtomicU64,
    echo_return_loss_enhancement_db: AtomicU64,
    residual_echo_likelihood: AtomicU64,
    vad_probability: AtomicU32,
    timestamp_regressions: AtomicU64,
    delay_history_faults: AtomicU64,
    drift_range_faults: AtomicU64,
    capture_discontinuities: AtomicU64,
    echo_processing_faults: AtomicU64,
    max_alignment_error_frames: AtomicU64,
}

impl Default for DuplexMetricsInner {
    fn default() -> Self {
        Self {
            delay_hint_ms: AtomicU32::new(0),
            drift_correction_ppm: AtomicU32::new(0),
            render_rms: AtomicU32::new(0),
            render_peak: AtomicU32::new(0),
            raw_rms: AtomicU32::new(0),
            raw_peak: AtomicU32::new(0),
            clean_rms: AtomicU32::new(0),
            clean_peak: AtomicU32::new(0),
            clipped_fraction: AtomicU32::new(0),
            max_clipped_fraction: AtomicU32::new(0),
            echo_return_loss_db: AtomicU64::new(f64::NAN.to_bits()),
            echo_return_loss_enhancement_db: AtomicU64::new(f64::NAN.to_bits()),
            residual_echo_likelihood: AtomicU64::new(f64::NAN.to_bits()),
            vad_probability: AtomicU32::new(0),
            timestamp_regressions: AtomicU64::new(0),
            delay_history_faults: AtomicU64::new(0),
            drift_range_faults: AtomicU64::new(0),
            capture_discontinuities: AtomicU64::new(0),
            echo_processing_faults: AtomicU64::new(0),
            max_alignment_error_frames: AtomicU64::new(0),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DuplexMetricsSnapshot {
    pub delay_hint_ms: u32,
    pub drift_correction_ppm: f32,
    pub render_rms: f32,
    pub render_peak: f32,
    pub raw_rms: f32,
    pub raw_peak: f32,
    pub clean_rms: f32,
    pub clean_peak: f32,
    pub clipped_fraction: f32,
    pub max_clipped_fraction: f32,
    pub echo_return_loss_db: Option<f64>,
    pub echo_return_loss_enhancement_db: Option<f64>,
    pub residual_echo_likelihood: Option<f64>,
    pub vad_probability: f32,
    pub timestamp_regressions: u64,
    pub delay_history_faults: u64,
    pub drift_range_faults: u64,
    pub capture_discontinuities: u64,
    pub echo_processing_faults: u64,
    pub max_alignment_error_frames: u64,
}

impl DuplexMetrics {
    fn update_echo(&self, report: &crate::EchoReport) {
        self.0
            .delay_hint_ms
            .store(report.delay_hint_ms, Ordering::Relaxed);
        self.0
            .render_rms
            .store(report.render_rms.to_bits(), Ordering::Relaxed);
        self.0
            .render_peak
            .store(report.render_peak.to_bits(), Ordering::Relaxed);
        self.0
            .raw_rms
            .store(report.raw_rms.to_bits(), Ordering::Relaxed);
        self.0
            .raw_peak
            .store(report.raw_peak.to_bits(), Ordering::Relaxed);
        self.0
            .clean_rms
            .store(report.clean_rms.to_bits(), Ordering::Relaxed);
        self.0
            .clean_peak
            .store(report.clean_peak.to_bits(), Ordering::Relaxed);
        self.0
            .clipped_fraction
            .store(report.clipped_fraction.to_bits(), Ordering::Relaxed);
        self.0
            .max_clipped_fraction
            .fetch_max(report.clipped_fraction.to_bits(), Ordering::Relaxed);
        store_optional_f64(&self.0.echo_return_loss_db, report.echo_return_loss_db);
        store_optional_f64(
            &self.0.echo_return_loss_enhancement_db,
            report.echo_return_loss_enhancement_db,
        );
        store_optional_f64(
            &self.0.residual_echo_likelihood,
            report.residual_echo_likelihood,
        );
    }

    fn update_vad(&self, probability: f32) {
        self.0
            .vad_probability
            .store(probability.to_bits(), Ordering::Relaxed);
    }

    fn update_clock(&self, correction_ppm: f64) {
        self.0
            .drift_correction_ppm
            .store((correction_ppm as f32).to_bits(), Ordering::Relaxed);
    }

    fn record_clock_fault(&self, fault: ClockFault) {
        let counter = match fault {
            ClockFault::TimestampRegression => &self.0.timestamp_regressions,
            ClockFault::DelayOutsideHistory => &self.0.delay_history_faults,
            ClockFault::DriftOutsideRange => &self.0.drift_range_faults,
        };
        counter.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> DuplexMetricsSnapshot {
        DuplexMetricsSnapshot {
            delay_hint_ms: self.0.delay_hint_ms.load(Ordering::Relaxed),
            drift_correction_ppm: f32::from_bits(
                self.0.drift_correction_ppm.load(Ordering::Relaxed),
            ),
            render_rms: f32::from_bits(self.0.render_rms.load(Ordering::Relaxed)),
            render_peak: f32::from_bits(self.0.render_peak.load(Ordering::Relaxed)),
            raw_rms: f32::from_bits(self.0.raw_rms.load(Ordering::Relaxed)),
            raw_peak: f32::from_bits(self.0.raw_peak.load(Ordering::Relaxed)),
            clean_rms: f32::from_bits(self.0.clean_rms.load(Ordering::Relaxed)),
            clean_peak: f32::from_bits(self.0.clean_peak.load(Ordering::Relaxed)),
            clipped_fraction: f32::from_bits(self.0.clipped_fraction.load(Ordering::Relaxed)),
            max_clipped_fraction: f32::from_bits(
                self.0.max_clipped_fraction.load(Ordering::Relaxed),
            ),
            echo_return_loss_db: load_optional_f64(&self.0.echo_return_loss_db),
            echo_return_loss_enhancement_db: load_optional_f64(
                &self.0.echo_return_loss_enhancement_db,
            ),
            residual_echo_likelihood: load_optional_f64(&self.0.residual_echo_likelihood),
            vad_probability: f32::from_bits(self.0.vad_probability.load(Ordering::Relaxed)),
            timestamp_regressions: self.0.timestamp_regressions.load(Ordering::Relaxed),
            delay_history_faults: self.0.delay_history_faults.load(Ordering::Relaxed),
            drift_range_faults: self.0.drift_range_faults.load(Ordering::Relaxed),
            capture_discontinuities: self.0.capture_discontinuities.load(Ordering::Relaxed),
            echo_processing_faults: self.0.echo_processing_faults.load(Ordering::Relaxed),
            max_alignment_error_frames: self.0.max_alignment_error_frames.load(Ordering::Relaxed),
        }
    }
}

fn store_optional_f64(slot: &AtomicU64, value: Option<f64>) {
    slot.store(value.unwrap_or(f64::NAN).to_bits(), Ordering::Relaxed);
}

fn load_optional_f64(slot: &AtomicU64) -> Option<f64> {
    let value = f64::from_bits(slot.load(Ordering::Relaxed));
    value.is_finite().then_some(value)
}

pub struct InputModels {
    pub vad: Box<dyn VoiceActivityDetector>,
    pub recognizer: Box<dyn StreamingRecognizer>,
}

#[derive(Clone, Debug)]
pub struct DiagnosticAudioFrame {
    pub at: MonoTimeNs,
    pub raw: AudioFrame48k,
    pub clean: AudioFrame48k,
}

/// Optional native-only tap for qualification tools. It never runs in an audio
/// callback, never crosses IPC, and overwrites the oldest complete frame if a
/// diagnostic consumer falls behind.
#[derive(Clone, Debug)]
pub struct PipelineAudioTap {
    frames: crate::BoundedRing<DiagnosticAudioFrame>,
}

impl PipelineAudioTap {
    pub fn new(capacity_frames: usize) -> Self {
        Self {
            frames: crate::BoundedRing::new(capacity_frames),
        }
    }

    pub fn pop(&self) -> Option<DiagnosticAudioFrame> {
        self.frames.pop()
    }

    fn record(&self, frame: DiagnosticAudioFrame) {
        self.frames.push_overwrite_oldest(frame);
    }
}

#[derive(Clone, Copy)]
struct CleanFrame {
    samples: [f32; 160],
    at: MonoTimeNs,
    far_end_active: bool,
    echo_status: EchoStatus,
    safe_echo_continuous: bool,
}

enum InputControl {
    Reset,
    Overflow,
    Stop,
}

enum DspControl {
    Reset,
    Stop,
}

pub struct DuplexPipeline {
    dsp_control: Sender<DspControl>,
    input_control: Sender<InputControl>,
    dsp_thread: Option<JoinHandle<()>>,
    input_thread: Option<JoinHandle<InputModels>>,
    metrics: DuplexMetrics,
}

pub struct DuplexPipelineConfig {
    pub session_id: SessionId,
    pub route_generation: RouteGeneration,
    pub input_rate_hz: u32,
    pub input_channels: u16,
    pub output_rate_hz: u32,
    pub input_timestamp_quality: TimestampQuality,
    pub output_timestamp_quality: TimestampQuality,
    /// Optional route-specific acoustic delay for callback-only timestamp
    /// backends. Hardware and host-estimated clocks ignore this override.
    pub callback_only_delay_hint_ms: Option<u32>,
    pub diagnostic_audio_tap: Option<PipelineAudioTap>,
    pub id_prefix: String,
}

impl DuplexPipeline {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        config: DuplexPipelineConfig,
        voice_config: VoiceConfigV1,
        capture: CapturePort,
        render: RenderPort,
        mut echo: Box<dyn EchoProcessor>,
        models: InputModels,
        observer: RuntimeObserver,
    ) -> Result<Self, &'static str> {
        let capture_resampler =
            StreamingSincResampler::new(config.input_rate_hz, PROCESSING_RATE_HZ)
                .map_err(|_| "invalid capture sample rate")?;
        let render_resampler =
            StreamingSincResampler::new(config.output_rate_hz, PROCESSING_RATE_HZ)
                .map_err(|_| "invalid render sample rate")?;
        let clean_resampler = StreamingSincResampler::new(PROCESSING_RATE_HZ, ASR_RATE_HZ)
            .map_err(|_| "invalid clean sample rate")?;
        echo.reset(ProcessingFormat::default(), config.route_generation);

        let (clean_tx, clean_rx) = bounded::<CleanFrame>(CLEAN_QUEUE_FRAMES);
        let metrics = DuplexMetrics::default();
        let (input_control_tx, input_control_rx) = bounded::<InputControl>(4);
        let input_observer = observer.clone();
        let input_generation = config.route_generation;
        let input_prefix = config.id_prefix.clone();
        let input_voice_config = voice_config.clone();
        let clock_config = voice_config.clone();
        let input_metrics = metrics.clone();
        let input_thread = std::thread::Builder::new()
            .name("aven-voice-input".into())
            .spawn(move || {
                input_loop(
                    input_voice_config,
                    models,
                    clean_rx,
                    input_control_rx,
                    input_observer,
                    input_generation,
                    input_prefix,
                    input_metrics,
                )
            })
            .map_err(|_| "input worker could not start")?;

        let (dsp_control_tx, dsp_control_rx) = bounded::<DspControl>(2);
        let input_overflow = input_control_tx.clone();
        let dsp_metrics = metrics.clone();
        let dsp_thread = std::thread::Builder::new()
            .name("aven-voice-dsp".into())
            .spawn(move || {
                let mut worker = DspWorker {
                    config,
                    voice_config,
                    capture: capture.clone(),
                    render: render.clone(),
                    echo,
                    aligner: ClockAligner::new(clock_config),
                    capture_resampler,
                    render_resampler,
                    clean_resampler,
                    capture_mono: Vec::with_capacity(MAX_CALLBACK_SAMPLES),
                    render_mono: Vec::with_capacity(MAX_CALLBACK_SAMPLES),
                    resampled: Vec::with_capacity(MAX_RESAMPLED_SAMPLES),
                    capture_48k: VecDeque::with_capacity(PROCESSING_FRAME_SAMPLES * 4),
                    capture_48k_at: None,
                    render_48k: VecDeque::with_capacity(PROCESSING_FRAME_SAMPLES * 4),
                    render_48k_at: None,
                    capture_resampled_frames: 0,
                    render_resampled_frames: 0,
                    last_render_end_at: None,
                    alignment_baseline_frames: None,
                    clean_16k: VecDeque::with_capacity(160 * 4),
                    clean_16k_at: None,
                    clean_tx,
                    input_overflow,
                    observer,
                    last_echo: EchoStatus::Bypassed,
                    last_render_rms: 0.0,
                    metrics: dsp_metrics,
                };
                worker.run(
                    capture.activity(),
                    render.reference_activity(),
                    dsp_control_rx,
                );
            })
            .map_err(|_| "DSP worker could not start")?;

        Ok(Self {
            dsp_control: dsp_control_tx,
            input_control: input_control_tx,
            dsp_thread: Some(dsp_thread),
            input_thread: Some(input_thread),
            metrics,
        })
    }

    pub fn reset_input(&self) {
        let _ = self.input_control.try_send(InputControl::Reset);
        let _ = self.dsp_control.try_send(DspControl::Reset);
    }

    pub fn metrics(&self) -> DuplexMetrics {
        self.metrics.clone()
    }

    pub fn stop(mut self) -> InputModels {
        let _ = self.dsp_control.send(DspControl::Stop);
        if let Some(thread) = self.dsp_thread.take() {
            let _ = thread.join();
        }
        let _ = self.input_control.send(InputControl::Stop);
        self.input_thread
            .take()
            .expect("input worker exists")
            .join()
            .expect("input worker must not panic")
    }
}

impl Drop for DuplexPipeline {
    fn drop(&mut self) {
        let _ = self.dsp_control.try_send(DspControl::Stop);
        let _ = self.input_control.try_send(InputControl::Stop);
        if let Some(thread) = self.dsp_thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.input_thread.take() {
            let _ = thread.join();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn input_loop(
    config: VoiceConfigV1,
    models: InputModels,
    clean: Receiver<CleanFrame>,
    controls: Receiver<InputControl>,
    observer: RuntimeObserver,
    generation: RouteGeneration,
    id_prefix: String,
    metrics: DuplexMetrics,
) -> InputModels {
    let mut processor = InputProcessor::new(config, models.vad, models.recognizer);
    let mut next_id = 0_u64;
    let mut candidate_echo_safe = true;
    loop {
        crossbeam_channel::select! {
            recv(controls) -> control => match control {
                Ok(InputControl::Reset) => {
                    processor.reset();
                    candidate_echo_safe = true;
                },
                Ok(InputControl::Overflow) => {
                    if let Some(InputModelEvent::DiscardedOverflow { candidate_id }) = processor.overflow() {
                        candidate_echo_safe = true;
                        let _ = observer.publish(Observation::CandidateOverflow { candidate_id, generation });
                    }
                }
                Ok(InputControl::Stop) | Err(_) => break,
            },
            recv(clean) -> frame => {
                let Ok(frame) = frame else { break };
                if processor.candidate_id().is_some()
                    && frame.far_end_active
                    && !frame.safe_echo_continuous
                {
                    candidate_echo_safe = false;
                }
                let events = processor.push_clean_16k(&frame.samples, || {
                    next_id = next_id.saturating_add(1);
                    CandidateId::parse(format!("{id_prefix}-c-{next_id}"))
                        .expect("bounded pipeline prefix creates a valid candidate ID")
                });
                metrics.update_vad(processor.last_vad_probability());
                for event in events {
                    let observation = match event {
                        InputModelEvent::CandidateStarted { candidate_id, .. } => {
                            candidate_echo_safe = !frame.far_end_active
                                || frame.safe_echo_continuous;
                            Observation::VadStarted {
                                candidate_id,
                                generation,
                                far_end_active: frame.far_end_active,
                                echo_status: frame.echo_status,
                                at: frame.at,
                            }
                        },
                        InputModelEvent::Partial { candidate_id, text } => Observation::RecognizerPartial {
                            candidate_id,
                            generation,
                            text,
                            far_end_active: frame.far_end_active,
                            safe_echo_continuous: candidate_echo_safe,
                        },
                        InputModelEvent::Ended { candidate_id, text } => {
                            let observation = Observation::RecognizerFinal {
                                candidate_id,
                                generation,
                                text,
                                far_end_active: frame.far_end_active,
                                safe_echo_continuous: candidate_echo_safe,
                            };
                            candidate_echo_safe = true;
                            observation
                        },
                        InputModelEvent::DiscardedOverflow { candidate_id } => {
                            candidate_echo_safe = true;
                            Observation::CandidateOverflow {
                                candidate_id,
                                generation,
                            }
                        },
                        InputModelEvent::ModelFailed { candidate_id, .. } => {
                            candidate_echo_safe = true;
                            Observation::InputModelFailed {
                                candidate_id,
                                generation,
                            }
                        },
                    };
                    let _ = observer.publish(observation);
                }
            }
        }
    }
    let (vad, recognizer) = processor.into_models();
    InputModels { vad, recognizer }
}

struct DspWorker {
    config: DuplexPipelineConfig,
    voice_config: VoiceConfigV1,
    capture: CapturePort,
    render: RenderPort,
    echo: Box<dyn EchoProcessor>,
    aligner: ClockAligner,
    capture_resampler: StreamingSincResampler,
    render_resampler: StreamingSincResampler,
    clean_resampler: StreamingSincResampler,
    capture_mono: Vec<f32>,
    render_mono: Vec<f32>,
    resampled: Vec<f32>,
    capture_48k: VecDeque<f32>,
    capture_48k_at: Option<MonoTimeNs>,
    render_48k: VecDeque<f32>,
    render_48k_at: Option<MonoTimeNs>,
    capture_resampled_frames: u64,
    render_resampled_frames: u64,
    last_render_end_at: Option<MonoTimeNs>,
    alignment_baseline_frames: Option<f64>,
    clean_16k: VecDeque<f32>,
    clean_16k_at: Option<MonoTimeNs>,
    clean_tx: Sender<CleanFrame>,
    input_overflow: Sender<InputControl>,
    observer: RuntimeObserver,
    last_echo: EchoStatus,
    last_render_rms: f32,
    metrics: DuplexMetrics,
}

impl DspWorker {
    fn run(
        &mut self,
        capture_activity: Receiver<MonoTimeNs>,
        render_activity: Receiver<MonoTimeNs>,
        controls: Receiver<DspControl>,
    ) {
        loop {
            crossbeam_channel::select! {
                recv(controls) -> control => match control {
                    Ok(DspControl::Reset) => self.reset(),
                    Ok(DspControl::Stop) | Err(_) => break,
                },
                recv(capture_activity) -> wake => {
                    if wake.is_err() { break; }
                    self.drain_render();
                    self.drain_capture();
                },
                recv(render_activity) -> wake => {
                    if wake.is_err() { break; }
                    self.drain_render();
                }
            }
        }
    }

    fn reset(&mut self) {
        self.aligner.reset();
        self.echo
            .reset(ProcessingFormat::default(), self.config.route_generation);
        self.capture_resampler
            .reset(self.config.input_rate_hz, PROCESSING_RATE_HZ)
            .expect("validated capture rates");
        self.render_resampler
            .reset(self.config.output_rate_hz, PROCESSING_RATE_HZ)
            .expect("validated render rates");
        self.clean_resampler
            .reset(PROCESSING_RATE_HZ, ASR_RATE_HZ)
            .expect("fixed clean rates");
        self.capture_48k.clear();
        self.capture_48k_at = None;
        self.render_48k.clear();
        self.render_48k_at = None;
        self.capture_resampled_frames = 0;
        self.render_resampled_frames = 0;
        self.last_render_end_at = None;
        self.alignment_baseline_frames = None;
        self.clean_16k.clear();
        self.clean_16k_at = None;
        self.last_echo = EchoStatus::Bypassed;
        self.last_render_rms = 0.0;
    }

    fn drain_render(&mut self) {
        if self.render.take_reference_degraded() {
            self.publish_echo(EchoStatus::Degraded);
            self.reset();
        }
        while let Some(chunk) = self.render.pop_reference() {
            let at = chunk.time.first_frame_at.unwrap_or(chunk.time.callback_at);
            if let Err(fault) = self.aligner.observe_render(at) {
                self.metrics.record_clock_fault(fault);
                self.publish_echo(EchoStatus::Degraded);
                self.reset();
                continue;
            }
            self.render_mono.clear();
            self.render_mono.extend_from_slice(chunk.values());
            self.resampled.clear();
            self.render_resampler
                .process(&self.render_mono, &mut self.resampled);
            if self.resampled.len() > MAX_RESAMPLED_SAMPLES {
                self.publish_echo(EchoStatus::Degraded);
                self.reset();
                continue;
            }
            if self.render_48k.is_empty() {
                self.render_48k_at = Some(at);
            }
            self.render_resampled_frames = self
                .render_resampled_frames
                .saturating_add(self.resampled.len() as u64);
            self.last_render_end_at = Some(advance_samples(at, self.resampled.len()));
            self.render_48k.extend(self.resampled.drain(..));
            while self.render_48k.len() >= PROCESSING_FRAME_SAMPLES {
                let frame_at = self.render_48k_at.unwrap_or(at);
                let mut frame = AudioFrame48k::default();
                for sample in &mut frame.0 {
                    *sample = self.render_48k.pop_front().unwrap();
                }
                self.last_render_rms = frame.rms();
                if self.echo.process_render(&frame, frame_at, 0).is_err() {
                    self.metrics
                        .0
                        .echo_processing_faults
                        .fetch_add(1, Ordering::Relaxed);
                    self.publish_echo(EchoStatus::Degraded);
                    self.reset();
                    return;
                }
                self.render_48k_at = Some(advance_processing_frame(frame_at));
            }
        }
    }

    fn drain_capture(&mut self) {
        if self.capture.take_discontinuity() {
            self.metrics
                .0
                .capture_discontinuities
                .fetch_add(1, Ordering::Relaxed);
            self.publish_echo(EchoStatus::Degraded);
            self.reset();
            let _ = self.input_overflow.try_send(InputControl::Overflow);
        }
        while let Some(chunk) = self.capture.pop() {
            let at = chunk.time.first_frame_at.unwrap_or(chunk.time.callback_at);
            let _ = self.observer.publish(Observation::CaptureArrived {
                session_id: self.config.session_id.clone(),
                generation: self.config.route_generation,
                at,
            });
            self.capture_mono.clear();
            downmix(chunk.values(), chunk.channels, &mut self.capture_mono);
            self.resampled.clear();
            self.capture_resampler
                .process(&self.capture_mono, &mut self.resampled);
            if self.resampled.len() > MAX_RESAMPLED_SAMPLES {
                let _ = self.input_overflow.try_send(InputControl::Overflow);
                self.publish_echo(EchoStatus::Degraded);
                self.reset();
                continue;
            }
            if self.capture_48k.is_empty() {
                self.capture_48k_at = Some(at);
            }
            self.capture_resampled_frames = self
                .capture_resampled_frames
                .saturating_add(self.resampled.len() as u64);
            let capture_end_at = advance_samples(at, self.resampled.len());
            let callback_clock_only = self.config.input_timestamp_quality
                == TimestampQuality::CallbackOnly
                || self.config.output_timestamp_quality == TimestampQuality::CallbackOnly;
            let queue_error_frames = if callback_clock_only {
                0
            } else {
                let error = alignment_error_frames(
                    self.capture_resampled_frames,
                    capture_end_at,
                    self.render_resampled_frames,
                    self.last_render_end_at,
                    &mut self.alignment_baseline_frames,
                );
                self.metrics
                    .0
                    .max_alignment_error_frames
                    .fetch_max(u64::from(error.unsigned_abs()), Ordering::Relaxed);
                error
            };
            self.capture_48k.extend(self.resampled.drain(..));
            while self.capture_48k.len() >= PROCESSING_FRAME_SAMPLES {
                let frame_at = self.capture_48k_at.unwrap_or(at);
                let mut raw = AudioFrame48k::default();
                for sample in &mut raw.0 {
                    *sample = self.capture_48k.pop_front().unwrap();
                }
                let clock = if callback_clock_only {
                    self.aligner.observe_capture_callback_clock(
                        frame_at,
                        self.config.callback_only_delay_hint_ms,
                    )
                } else {
                    self.aligner
                        .observe_capture(frame_at, queue_error_frames, 10)
                };
                self.metrics.update_clock(clock.correction_ppm);
                if let Some(fault) = clock.fault {
                    self.metrics.record_clock_fault(fault);
                    self.publish_echo(EchoStatus::Degraded);
                    self.reset();
                    break;
                }
                if self
                    .capture_resampler
                    .set_relative_ratio(1.0 + clock.correction_ppm / 1_000_000.0)
                    .is_err()
                {
                    self.publish_echo(EchoStatus::Degraded);
                    self.reset();
                    break;
                }
                let mut clean = AudioFrame48k::default();
                match self
                    .echo
                    .process_capture(&raw, frame_at, clock.delay_hint_ms, &mut clean)
                {
                    Ok(report) => {
                        if let Some(tap) = &self.config.diagnostic_audio_tap {
                            tap.record(DiagnosticAudioFrame {
                                at: frame_at,
                                raw: raw.clone(),
                                clean: clean.clone(),
                            });
                        }
                        self.metrics.update_echo(&report);
                        self.publish_echo(report.state);
                        self.resampled.clear();
                        self.clean_resampler.process(&clean.0, &mut self.resampled);
                        if self.clean_16k.is_empty() {
                            self.clean_16k_at = Some(frame_at);
                        }
                        self.clean_16k.extend(self.resampled.drain(..));
                        while self.clean_16k.len() >= 160 {
                            let clean_at = self.clean_16k_at.unwrap_or(frame_at);
                            let mut samples = [0.0; 160];
                            for sample in &mut samples {
                                *sample = self.clean_16k.pop_front().unwrap();
                            }
                            let message = CleanFrame {
                                samples,
                                at: clean_at,
                                far_end_active: self.last_render_rms
                                    >= self.voice_config.render_silence_rms,
                                echo_status: report.state,
                                safe_echo_continuous: report.state == EchoStatus::Converged,
                            };
                            if let Err(error) = self.clean_tx.try_send(message) {
                                if matches!(error, TrySendError::Full(_)) {
                                    let _ = self.input_overflow.try_send(InputControl::Overflow);
                                }
                            }
                            self.clean_16k_at = Some(advance_processing_frame(clean_at));
                        }
                    }
                    Err(_) => {
                        self.metrics
                            .0
                            .echo_processing_faults
                            .fetch_add(1, Ordering::Relaxed);
                        self.publish_echo(EchoStatus::Degraded);
                        self.reset();
                        break;
                    }
                }
                self.capture_48k_at = Some(advance_processing_frame(frame_at));
            }
        }
    }

    fn publish_echo(&mut self, status: EchoStatus) {
        if status != self.last_echo {
            self.last_echo = status;
            let _ = self.observer.publish(Observation::EchoChanged {
                generation: self.config.route_generation,
                status,
            });
        }
    }
}

fn advance_processing_frame(at: MonoTimeNs) -> MonoTimeNs {
    MonoTimeNs(at.0.saturating_add(u64::from(crate::PROCESSING_FRAME_MS) * 1_000_000))
}

fn advance_samples(at: MonoTimeNs, samples: usize) -> MonoTimeNs {
    MonoTimeNs(
        at.0.saturating_add(
            (samples as u64)
                .saturating_mul(1_000_000_000)
                .div_ceil(u64::from(PROCESSING_RATE_HZ)),
        ),
    )
}

/// Difference between capture output and the render timeline at the same
/// monotonic instant. The first paired callback establishes the route's fixed
/// phase/delay; subsequent movement is queue-fill error for the drift servo.
fn alignment_error_frames(
    capture_frames: u64,
    capture_end_at: MonoTimeNs,
    render_frames: u64,
    render_end_at: Option<MonoTimeNs>,
    baseline: &mut Option<f64>,
) -> i32 {
    let Some(render_end_at) = render_end_at else {
        return 0;
    };
    let time_delta_ns = capture_end_at.0 as i128 - render_end_at.0 as i128;
    let predicted_render = render_frames as f64
        + time_delta_ns as f64 * f64::from(PROCESSING_RATE_HZ) / 1_000_000_000.0;
    let phase = capture_frames as f64 - predicted_render;
    let initial = *baseline.get_or_insert(phase);
    (initial - phase)
        .round()
        .clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

fn downmix(interleaved: &[f32], channels: u16, output: &mut Vec<f32>) {
    let channels = usize::from(channels);
    if channels == 0 {
        return;
    }
    for frame in interleaved.chunks_exact(channels) {
        output.push(frame.iter().copied().sum::<f32>() / channels as f32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CallbackTime, FakeEchoProcessor, HostSampleFormat, ModelError, RecognizerUpdate,
        StreamDescriptor, TimestampQuality,
    };

    struct SpeechVad;

    #[test]
    fn alignment_error_tracks_relative_clock_queue_fill() {
        let mut baseline = None;
        assert_eq!(
            alignment_error_frames(
                480,
                MonoTimeNs::from_millis(60),
                2_880,
                Some(MonoTimeNs::from_millis(60)),
                &mut baseline,
            ),
            0
        );
        // The capture callback now spans 10.1 ms for 480 nominal frames while
        // render remains at 10 ms. It needs positive resampler correction.
        assert_eq!(
            alignment_error_frames(
                960,
                MonoTimeNs(70_100_000),
                3_360,
                Some(MonoTimeNs::from_millis(70)),
                &mut baseline,
            ),
            5
        );
    }

    impl VoiceActivityDetector for SpeechVad {
        fn reset(&mut self) {}

        fn probability(&mut self, _frame: &[f32; 512]) -> Result<f32, ModelError> {
            Ok(0.9)
        }
    }

    #[derive(Default)]
    struct Recognizer;

    impl StreamingRecognizer for Recognizer {
        fn begin(&mut self, _candidate: &CandidateId) -> Result<(), ModelError> {
            Ok(())
        }

        fn push(&mut self, _pcm_16k: &[f32]) -> Result<RecognizerUpdate, ModelError> {
            Ok(RecognizerUpdate::default())
        }

        fn finish(&mut self) -> Result<RecognizerUpdate, ModelError> {
            Ok(RecognizerUpdate::default())
        }

        fn cancel(&mut self) {}
    }

    #[test]
    fn callback_audio_reaches_vad_on_a_sleeping_bounded_pipeline() {
        let descriptor = StreamDescriptor {
            sample_rate_hz: 48_000,
            channels: 1,
            sample_format: HostSampleFormat::Float { bits: 32 },
            nominal_callback_frames: Some(480),
        };
        let capture = CapturePort::new(25, descriptor);
        let (render, _producer) = RenderPort::new(25, 50);
        let route = RouteGeneration(1);
        capture.activate(route);
        render.activate_route(route, aven_voice_core::OutputGeneration(0));
        let (observer, observations) = RuntimeObserver::test_pair(64);
        let pipeline = DuplexPipeline::spawn(
            DuplexPipelineConfig {
                session_id: SessionId::parse("session").unwrap(),
                route_generation: route,
                input_rate_hz: 48_000,
                input_channels: 1,
                output_rate_hz: 48_000,
                input_timestamp_quality: TimestampQuality::Hardware,
                output_timestamp_quality: TimestampQuality::Hardware,
                callback_only_delay_hint_ms: None,
                diagnostic_audio_tap: None,
                id_prefix: "pipeline".into(),
            },
            VoiceConfigV1::default(),
            capture.clone(),
            render,
            Box::new(FakeEchoProcessor::new(VoiceConfigV1::default(), 0.0)),
            InputModels {
                vad: Box::new(SpeechVad),
                recognizer: Box::new(Recognizer),
            },
            observer,
        )
        .unwrap();
        capture.write_f32(
            &[0.1; 4_800],
            1,
            CallbackTime {
                callback_at: MonoTimeNs(0),
                first_frame_at: Some(MonoTimeNs(0)),
                frame_position: Some(0),
                quality: TimestampQuality::Hardware,
            },
            route,
        );

        let mut candidate_at = None;
        for _ in 0..16 {
            let observation = observations
                .recv_timeout(std::time::Duration::from_secs(1))
                .expect("pipeline should publish bounded observations");
            if let Observation::VadStarted { at, .. } = observation {
                candidate_at = Some(at);
                break;
            }
        }
        assert!(candidate_at.is_some_and(|at| at > MonoTimeNs(0)));
        let _models = pipeline.stop();
    }
}
