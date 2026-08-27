use aven_voice_core::{CachedResult, Command};
use aven_voice_protocol::*;
use tauri::State;

use super::service::{ServiceError, VoiceService};

fn protocol_error(error: ValidationError) -> ServiceError {
	ServiceError {
		code: match error {
			ValidationError::InvalidProtocolVersion => VoiceErrorCode::ProtocolMismatch,
			ValidationError::InvalidText => VoiceErrorCode::InvalidText,
			ValidationError::InvalidId(_) | ValidationError::InvalidDecimal => {
				VoiceErrorCode::Internal
			}
		},
		message: error.to_string(),
	}
}

fn validate_meta(meta: &CommandMeta) -> Result<(), ServiceError> {
	meta.validate().map_err(protocol_error)
}

fn validate_id<T>(
	value: &str,
	parse: impl FnOnce(String) -> Result<T, ValidationError>,
) -> Result<(), ServiceError> {
	parse(value.to_owned()).map(|_| ()).map_err(protocol_error)
}

async fn blocking<T: Send + 'static>(
	operation: impl FnOnce() -> Result<T, ServiceError> + Send + 'static,
) -> Result<T, ServiceError> {
	tauri::async_runtime::spawn_blocking(operation)
		.await
		.map_err(|_| ServiceError {
			code: VoiceErrorCode::Internal,
			message: "The voice operation stopped unexpectedly.".into(),
		})?
}

#[tauri::command]
pub async fn voice_prepare(
	service: State<'_, VoiceService>,
	request: VoicePrepareRequest,
) -> Result<PreparationSnapshot, ServiceError> {
	validate_meta(&request.meta)?;
	let service = service.inner().clone();
	blocking(move || {
		let features = request.features.clone();
		service.command(Command::Prepare {
			request_id: request.meta.request_id,
			features: request.features,
		})?;
		Ok(service.wait_for_preparation(&features))
	})
	.await
}

#[tauri::command]
pub async fn voice_session_start(
	service: State<'_, VoiceService>,
	request: VoiceSessionStartRequest,
) -> Result<VoiceSessionStarted, ServiceError> {
	validate_meta(&request.meta)?;
	let service = service.inner().clone();
	blocking(move || {
		let result = service.command(Command::StartSession {
			request_id: request.meta.request_id,
			preferred_input: request.preferred_input,
			preferred_output: request.preferred_output,
		})?;
		let CachedResult::Session(session_id) = result else {
			return Err(internal(
				"The voice runtime returned an invalid session response.",
			));
		};
		let snapshot = service.wait_for_session(&session_id)?;
		Ok(VoiceSessionStarted {
			session_id,
			snapshot,
		})
	})
	.await
}

#[tauri::command]
pub async fn voice_session_stop(
	service: State<'_, VoiceService>,
	request: VoiceSessionStopRequest,
) -> Result<(), ServiceError> {
	validate_meta(&request.meta)?;
	validate_id(request.session_id.as_str(), SessionId::parse)?;
	let service = service.inner().clone();
	blocking(move || {
		let session_id = request.session_id.clone();
		service.command(Command::StopSession {
			request_id: request.meta.request_id,
			session_id: request.session_id,
		})?;
		service.set_diagnostics(session_id, false);
		Ok(())
	})
	.await
}

#[tauri::command]
pub async fn voice_speech_begin(
	service: State<'_, VoiceService>,
	request: VoiceSpeechBeginRequest,
) -> Result<SpeechTurnStarted, ServiceError> {
	validate_meta(&request.meta)?;
	validate_id(request.session_id.as_str(), SessionId::parse)?;
	if let Some(key) = &request.client_turn_key {
		validate_id(key.as_str(), ClientTurnKey::parse)?;
	}
	let service = service.inner().clone();
	blocking(move || {
		let result = service.command(Command::BeginSpeech {
			request_id: request.meta.request_id,
			session_id: request.session_id,
			client_turn_key: request.client_turn_key,
			language: request.language,
			voice: request.voice,
		})?;
		let CachedResult::Turn(turn_id) = result else {
			return Err(internal(
				"The voice runtime returned an invalid turn response.",
			));
		};
		Ok(SpeechTurnStarted {
			turn_id,
			pending_segment_capacity: 8,
		})
	})
	.await
}

#[tauri::command]
pub async fn voice_speech_enqueue(
	service: State<'_, VoiceService>,
	request: VoiceSpeechEnqueueRequest,
) -> Result<EnqueueResult, ServiceError> {
	validate_meta(&request.meta)?;
	request.validate_text().map_err(protocol_error)?;
	validate_id(request.session_id.as_str(), SessionId::parse)?;
	validate_id(request.turn_id.as_str(), TurnId::parse)?;
	let service = service.inner().clone();
	blocking(move || {
		let result = service.command(Command::EnqueueSpeech {
			request_id: request.meta.request_id,
			session_id: request.session_id,
			turn_id: request.turn_id,
			segment_index: request.segment_index,
			text: request.text,
		})?;
		let CachedResult::Enqueued {
			idempotent,
			remaining_capacity,
		} = result
		else {
			return Err(internal(
				"The voice runtime returned an invalid enqueue response.",
			));
		};
		Ok(EnqueueResult {
			accepted: true,
			idempotent,
			remaining_segment_capacity: remaining_capacity.min(u16::MAX as usize) as u16,
		})
	})
	.await
}

#[tauri::command]
pub async fn voice_speech_finish(
	service: State<'_, VoiceService>,
	request: VoiceSpeechFinishRequest,
) -> Result<(), ServiceError> {
	validate_meta(&request.meta)?;
	validate_id(request.session_id.as_str(), SessionId::parse)?;
	validate_id(request.turn_id.as_str(), TurnId::parse)?;
	let service = service.inner().clone();
	blocking(move || {
		service.command(Command::FinishSpeech {
			request_id: request.meta.request_id,
			session_id: request.session_id,
			turn_id: request.turn_id,
		})?;
		Ok(())
	})
	.await
}

#[tauri::command]
pub async fn voice_speech_cancel(
	service: State<'_, VoiceService>,
	request: VoiceSpeechCancelRequest,
) -> Result<(), ServiceError> {
	validate_meta(&request.meta)?;
	validate_id(request.session_id.as_str(), SessionId::parse)?;
	if let Some(turn) = &request.turn_id {
		validate_id(turn.as_str(), TurnId::parse)?;
	}
	let service = service.inner().clone();
	blocking(move || {
		service.command(Command::CancelSpeech {
			request_id: request.meta.request_id,
			session_id: request.session_id,
			turn_id: request.turn_id,
			reason: request.reason,
		})?;
		Ok(())
	})
	.await
}

#[tauri::command]
pub async fn voice_input_reset(
	service: State<'_, VoiceService>,
	request: VoiceInputResetRequest,
) -> Result<(), ServiceError> {
	validate_meta(&request.meta)?;
	validate_id(request.session_id.as_str(), SessionId::parse)?;
	let service = service.inner().clone();
	blocking(move || {
		service.command(Command::ResetInput {
			request_id: request.meta.request_id,
			session_id: request.session_id,
			reason: request.reason,
		})?;
		Ok(())
	})
	.await
}

#[tauri::command]
pub async fn voice_snapshot(
	service: State<'_, VoiceService>,
	request: VoiceSnapshotRequest,
) -> Result<VoiceSnapshot, ServiceError> {
	validate_meta(&request.meta)?;
	if let Some(session) = &request.session_id {
		validate_id(session.as_str(), SessionId::parse)?;
	}
	let service = service.inner().clone();
	blocking(move || service.snapshot(request.session_id)).await
}

#[tauri::command]
pub async fn voice_diagnostics_subscribe(
	service: State<'_, VoiceService>,
	request: VoiceDiagnosticsSubscribeRequest,
) -> Result<(), ServiceError> {
	validate_meta(&request.meta)?;
	validate_id(request.session_id.as_str(), SessionId::parse)?;
	let service = service.inner().clone();
	blocking(move || {
		service.command(Command::SetDiagnostics {
			request_id: request.meta.request_id,
			session_id: request.session_id.clone(),
			enabled: request.enabled,
		})?;
		service.set_diagnostics(request.session_id, request.enabled);
		Ok(())
	})
	.await
}

fn internal(message: &'static str) -> ServiceError {
	ServiceError {
		code: VoiceErrorCode::Internal,
		message: message.into(),
	}
}
