//! One shared CPAL duplex host. All recovery and voice policy stays in the
//! portable coordinator; this crate reports device facts and callback faults.

#![cfg(feature = "cpal-host")]

pub mod calibration;

use aven_voice_core::{MonoTimeNs, RouteGeneration};
use aven_voice_protocol::RouteId;
use aven_voice_runtime::{
    AudioPorts, CallbackTime, CaptureConditioning, DuplexHost, HostCallbackFaultCode, HostError,
    HostFaultCode, HostSampleFormat, RouteDescriptor, RouteRequest, StreamDescriptor,
    StreamDirection, TimestampQuality,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

struct OpenRoute {
    id: RouteId,
    generation: RouteGeneration,
    input: cpal::Stream,
    output: cpal::Stream,
    ports: AudioPorts,
}

pub struct CpalDuplexHost {
    host: cpal::Host,
    route: Option<OpenRoute>,
}

impl Default for CpalDuplexHost {
    fn default() -> Self {
        Self {
            host: cpal::default_host(),
            route: None,
        }
    }
}

impl CpalDuplexHost {
    pub fn new() -> Self {
        Self::default()
    }

    /// Human-readable backend and default-device names for control-thread
    /// diagnostics. This must not be called from an audio callback.
    pub fn diagnostic_identity(&self) -> HostDiagnosticIdentity {
        HostDiagnosticIdentity {
            backend: self.host.id().name(),
            input_device: self
                .host
                .default_input_device()
                .map(|device| device.to_string()),
            output_device: self
                .host
                .default_output_device()
                .map(|device| device.to_string()),
        }
    }

    /// Read the default duplex formats on the host-control worker so ports can
    /// allocate and validate their callback storage before `open` constructs
    /// stopped streams.
    pub fn default_route_descriptors(
        &self,
    ) -> Result<(StreamDescriptor, StreamDescriptor), HostError> {
        let input = self.host.default_input_device().ok_or_else(|| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "No microphone is available.",
                true,
            )
        })?;
        let output = self.host.default_output_device().ok_or_else(|| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "No speaker is available.",
                true,
            )
        })?;
        let input_default = input.default_input_config().map_err(|_| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "The microphone format could not be read.",
                true,
            )
        })?;
        let output_default = output.default_output_config().map_err(|_| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "The speaker format could not be read.",
                true,
            )
        })?;
        let input = select_float_config(
            input_default,
            input.supported_input_configs().map_err(|_| {
                host_error(
                    HostFaultCode::Backend,
                    "The microphone formats could not be read.",
                    true,
                )
            })?,
        )?;
        let output = select_float_config(
            output_default,
            output.supported_output_configs().map_err(|_| {
                host_error(
                    HostFaultCode::Backend,
                    "The speaker formats could not be read.",
                    true,
                )
            })?,
        )?;
        Ok((descriptor(&input), descriptor(&output)))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostDiagnosticIdentity {
    pub backend: &'static str,
    pub input_device: Option<String>,
    pub output_device: Option<String>,
}

impl DuplexHost for CpalDuplexHost {
    fn open(
        &mut self,
        request: RouteRequest,
        ports: AudioPorts,
    ) -> Result<RouteDescriptor, HostError> {
        if self.route.is_some() {
            return Err(host_error(
                HostFaultCode::StreamInvalidated,
                "The previous audio route is still open.",
                false,
            ));
        }
        // Preferences are deliberately opaque to portable policy. Until the app
        // exposes a stable CPAL preference mapping, `None` selects host defaults.
        if request.preferred_input.is_some() || request.preferred_output.is_some() {
            return Err(host_error(
                HostFaultCode::DeviceUnavailable,
                "The selected audio device is unavailable.",
                true,
            ));
        }
        let input_device = self.host.default_input_device().ok_or_else(|| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "No microphone is available.",
                true,
            )
        })?;
        let output_device = self.host.default_output_device().ok_or_else(|| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "No speaker is available.",
                true,
            )
        })?;
        let input_default = input_device.default_input_config().map_err(|_| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "The microphone format could not be read.",
                true,
            )
        })?;
        let output_default = output_device.default_output_config().map_err(|_| {
            host_error(
                HostFaultCode::DeviceUnavailable,
                "The speaker format could not be read.",
                true,
            )
        })?;
        let input_supported = select_float_config(
            input_default,
            input_device.supported_input_configs().map_err(|_| {
                host_error(
                    HostFaultCode::Backend,
                    "The microphone formats could not be read.",
                    true,
                )
            })?,
        )?;
        let output_supported = select_float_config(
            output_default,
            output_device.supported_output_configs().map_err(|_| {
                host_error(
                    HostFaultCode::Backend,
                    "The speaker formats could not be read.",
                    true,
                )
            })?,
        )?;

        let input_descriptor = descriptor(&input_supported);
        let output_descriptor = descriptor(&output_supported);
        if request.require_duplex
            && (input_descriptor.channels == 0 || output_descriptor.channels == 0)
        {
            return Err(host_error(
                HostFaultCode::DeviceUnavailable,
                "A duplex audio route is unavailable.",
                true,
            ));
        }
        let route_id = RouteId::parse(format!("cpal-route-{}", request.generation.0))
            .expect("bounded CPAL route ID");
        ports.events.bind_route(route_id.clone());

        let input_port = ports.capture.clone();
        let input_events = ports.events.clone();
        let input_generation = request.generation;
        let input_channels = input_descriptor.channels;
        let input_config = stream_config(input_supported);
        let input = input_device
            .build_input_stream(
                input_config,
                move |data: &[f32], info| {
                    let timestamp = info.timestamp();
                    input_port.write_f32(
                        data,
                        input_channels,
                        CallbackTime {
                            callback_at: stream_time(timestamp.callback),
                            first_frame_at: Some(stream_time(timestamp.capture)),
                            frame_position: None,
                            quality: TimestampQuality::HostEstimated,
                        },
                        input_generation,
                    );
                },
                move |error| {
                    input_events.publish_callback_fault(
                        input_generation,
                        StreamDirection::Capture,
                        callback_fault_code(error.kind()),
                    );
                },
                None,
            )
            .map_err(|_| {
                host_error(
                    HostFaultCode::Backend,
                    "The microphone stream could not be opened.",
                    true,
                )
            })?;

        let output_port = ports.render.clone();
        let output_events = ports.events.clone();
        let output_generation = request.generation;
        let output_channels = output_descriptor.channels;
        let output_config = stream_config(output_supported);
        let output = output_device
            .build_output_stream(
                output_config,
                move |data: &mut [f32], info| {
                    let timestamp = info.timestamp();
                    output_port.fill_f32(
                        data,
                        output_channels,
                        CallbackTime {
                            callback_at: stream_time(timestamp.callback),
                            first_frame_at: Some(stream_time(timestamp.playback)),
                            frame_position: None,
                            quality: TimestampQuality::HostEstimated,
                        },
                        output_generation,
                    );
                },
                move |error| {
                    output_events.publish_callback_fault(
                        output_generation,
                        StreamDirection::Render,
                        callback_fault_code(error.kind()),
                    );
                },
                None,
            )
            .map_err(|_| {
                host_error(
                    HostFaultCode::Backend,
                    "The speaker stream could not be opened.",
                    true,
                )
            })?;

        let descriptor = RouteDescriptor {
            route_id: route_id.clone(),
            generation: request.generation,
            input: input_descriptor,
            output: output_descriptor,
            input_timestamp_quality: TimestampQuality::HostEstimated,
            output_timestamp_quality: TimestampQuality::HostEstimated,
            capture_conditioning: CaptureConditioning::Raw,
        };
        self.route = Some(OpenRoute {
            id: route_id,
            generation: request.generation,
            input,
            output,
            ports,
        });
        Ok(descriptor)
    }

    fn start(&mut self, route: &RouteId) -> Result<(), HostError> {
        let opened = self
            .route
            .as_ref()
            .filter(|opened| &opened.id == route)
            .ok_or_else(|| {
                host_error(
                    HostFaultCode::StreamInvalidated,
                    "The audio route is stale.",
                    true,
                )
            })?;
        opened.ports.capture.activate(opened.generation);
        opened
            .ports
            .render
            .activate_route_current_generation(opened.generation);
        if opened.input.play().is_err() || opened.output.play().is_err() {
            opened.ports.capture.deactivate();
            opened.ports.render.deactivate_route();
            let _ = opened.input.pause();
            let _ = opened.output.pause();
            return Err(host_error(
                HostFaultCode::Backend,
                "The audio route could not be started.",
                true,
            ));
        }
        opened
            .ports
            .events
            .publish(aven_voice_runtime::HostEvent::Started {
                route: opened.id.clone(),
                generation: opened.generation,
            });
        Ok(())
    }

    fn close(&mut self, route: &RouteId) -> Result<(), HostError> {
        if self
            .route
            .as_ref()
            .is_some_and(|opened| &opened.id == route)
        {
            let opened = self.route.take().unwrap();
            opened.ports.capture.deactivate();
            opened.ports.render.deactivate_route();
            let _ = opened.input.pause();
            let _ = opened.output.pause();
        }
        Ok(())
    }
}

fn descriptor(config: &cpal::SupportedStreamConfig) -> StreamDescriptor {
    StreamDescriptor {
        sample_rate_hz: config.sample_rate(),
        channels: config.channels(),
        sample_format: HostSampleFormat::Float { bits: 32 },
        nominal_callback_frames: selected_buffer_frames(config),
    }
}

fn stream_config(supported: cpal::SupportedStreamConfig) -> cpal::StreamConfig {
    let buffer_size = selected_buffer_frames(&supported)
        .map(cpal::BufferSize::Fixed)
        .unwrap_or_default();
    let mut config: cpal::StreamConfig = supported.into();
    config.buffer_size = buffer_size;
    config
}

fn selected_buffer_frames(config: &cpal::SupportedStreamConfig) -> Option<u32> {
    let target = config.sample_rate().div_ceil(100);
    match config.buffer_size() {
        cpal::SupportedBufferSize::Range { min, max } => Some(target.clamp(*min, *max)),
        cpal::SupportedBufferSize::Unknown => None,
    }
}

fn select_float_config(
    default: cpal::SupportedStreamConfig,
    supported: impl Iterator<Item = cpal::SupportedStreamConfigRange>,
) -> Result<cpal::SupportedStreamConfig, HostError> {
    if default.sample_format() == cpal::SampleFormat::F32 {
        return Ok(default);
    }
    let mut fallback = None;
    for range in supported.filter(|range| range.sample_format() == cpal::SampleFormat::F32) {
        if let Some(at_48k) = range.try_with_sample_rate(48_000) {
            return Ok(at_48k);
        }
        fallback.get_or_insert_with(|| range.with_max_sample_rate());
    }
    fallback.ok_or_else(|| {
        host_error(
            HostFaultCode::Backend,
            "The audio route does not provide 32-bit float streams.",
            false,
        )
    })
}

fn stream_time(value: cpal::StreamInstant) -> MonoTimeNs {
    MonoTimeNs(value.as_nanos().min(u128::from(u64::MAX)) as u64)
}

fn callback_fault_code(kind: cpal::ErrorKind) -> HostCallbackFaultCode {
    match kind {
        cpal::ErrorKind::DeviceBusy => HostCallbackFaultCode::DeviceBusy,
        cpal::ErrorKind::DeviceChanged => HostCallbackFaultCode::DeviceChanged,
        cpal::ErrorKind::DeviceNotAvailable => HostCallbackFaultCode::DeviceNotAvailable,
        cpal::ErrorKind::HostUnavailable => HostCallbackFaultCode::HostUnavailable,
        cpal::ErrorKind::InvalidInput => HostCallbackFaultCode::InvalidInput,
        cpal::ErrorKind::PermissionDenied => HostCallbackFaultCode::PermissionDenied,
        cpal::ErrorKind::RealtimeDenied => HostCallbackFaultCode::RealtimeDenied,
        cpal::ErrorKind::ResourceExhausted => HostCallbackFaultCode::ResourceExhausted,
        cpal::ErrorKind::StreamInvalidated => HostCallbackFaultCode::StreamInvalidated,
        cpal::ErrorKind::UnsupportedConfig => HostCallbackFaultCode::UnsupportedConfig,
        cpal::ErrorKind::UnsupportedOperation => HostCallbackFaultCode::UnsupportedOperation,
        cpal::ErrorKind::Xrun => HostCallbackFaultCode::Xrun,
        cpal::ErrorKind::BackendError => HostCallbackFaultCode::Backend,
        cpal::ErrorKind::Other => HostCallbackFaultCode::Other,
        _ => HostCallbackFaultCode::Other,
    }
}

fn host_error(code: HostFaultCode, user_message: &'static str, recoverable: bool) -> HostError {
    HostError {
        code,
        user_message: user_message.into(),
        recoverable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_timestamps_are_monotonic_nanoseconds() {
        assert_eq!(
            stream_time(cpal::StreamInstant::new(2, 3)),
            MonoTimeNs(2_000_000_003)
        );
    }

    #[test]
    fn callback_buffer_targets_ten_ms_within_the_supported_range() {
        let config = cpal::SupportedStreamConfig::new(
            1,
            48_000,
            cpal::SupportedBufferSize::Range { min: 256, max: 512 },
            cpal::SampleFormat::F32,
        );
        assert_eq!(selected_buffer_frames(&config), Some(480));
        assert_eq!(
            stream_config(config).buffer_size,
            cpal::BufferSize::Fixed(480)
        );

        let clamped = cpal::SupportedStreamConfig::new(
            1,
            48_000,
            cpal::SupportedBufferSize::Range {
                min: 512,
                max: 1_024,
            },
            cpal::SampleFormat::F32,
        );
        assert_eq!(selected_buffer_frames(&clamped), Some(512));
    }
}
