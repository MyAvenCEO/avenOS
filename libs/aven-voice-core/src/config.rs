#[derive(Clone, Debug, PartialEq)]
pub struct VoiceConfigV1 {
    /// Release gate for automatic interruption while far-end audio is audible.
    /// It remains off until the physical AEC qualification gates pass.
    pub allow_full_duplex_barge_in: bool,
    pub speech_threshold: f32,
    pub start_windows: u32,
    pub end_windows: u32,
    pub target_asr_peak: f32,
    pub max_asr_gain: f32,
    pub output_fade_ms: u32,
    pub max_synthesized_lead_ms: u32,
    pub max_queued_segments: usize,
    pub max_segment_chars: usize,
    pub aec_min_adaptation_ms: u32,
    pub aec_stable_delay_ms: u32,
    pub aec_history_ms: u32,
    pub render_silence_rms: f32,
    pub saturation_fraction: f32,
    pub saturation_frames: u32,
    pub maximum_drift_ppm: u32,
    pub drift_slew_ppm_per_second: u32,
}

impl Default for VoiceConfigV1 {
    fn default() -> Self {
        Self {
            allow_full_duplex_barge_in: false,
            speech_threshold: 0.5,
            start_windows: 2,
            end_windows: 28,
            target_asr_peak: 0.7,
            max_asr_gain: 8.0,
            output_fade_ms: 80,
            max_synthesized_lead_ms: 4_000,
            max_queued_segments: 8,
            max_segment_chars: 512,
            aec_min_adaptation_ms: 300,
            aec_stable_delay_ms: 200,
            aec_history_ms: 500,
            render_silence_rms: 0.001,
            saturation_fraction: 0.01,
            saturation_frames: 3,
            maximum_drift_ppm: 1_000,
            drift_slew_ppm_per_second: 50,
        }
    }
}
