use aven_voice_core::{
    Action, CachedResult, Command, MonoTimeNs, Observation, VoiceConfigV1, VoiceState,
};
use aven_voice_protocol::{RequestId, VoiceEvent, VoiceFeature};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SilentContributionFixture {
    pub text: String,
    pub session_id: String,
    pub speaker_id: String,
    pub confidence: f32,
}

/// Runs synthetic PCM through the production input worker and semantic state
/// machine without opening an audio device. The resulting value has the same
/// shape persisted by the application for a voice-authored contribution.
pub fn generate_silent_contribution_fixture() -> Result<SilentContributionFixture, String> {
    let config = VoiceConfigV1 {
        start_windows: 1,
        end_windows: 2,
        ..VoiceConfigV1::default()
    };
    let mut state = VoiceState::new("silent-audio-e2e", config);
    let (prepared, _) = state.command(
        Command::Prepare {
            request_id: RequestId::parse("silent-prepare").map_err(|error| error.to_string())?,
            features: vec![VoiceFeature::Input, VoiceFeature::Output],
        },
        MonoTimeNs(0),
    );
    prepared.map_err(|error| error.message)?;
    state.observe(
        Observation::ModelsPrepared {
            input: true,
            output: true,
        },
        MonoTimeNs(0),
    );
    let (started, _) = state.command(
        Command::StartSession {
            request_id: RequestId::parse("silent-start").map_err(|error| error.to_string())?,
            preferred_input: None,
            preferred_output: None,
        },
        MonoTimeNs(0),
    );
    let CachedResult::Session(session_id) = started.map_err(|error| error.message)? else {
        return Err("silent fixture did not start a session".into());
    };
    let generation = state.route_generation;
    state.observe(
        Observation::RouteStarted {
            session_id: session_id.clone(),
            generation,
        },
        MonoTimeNs(0),
    );

    let mut speaker = None;
    let mut text = None;
    for observation in super::pipeline::silent_fixture_observations(generation)? {
        for action in state.observe(observation, MonoTimeNs(1)) {
            match action {
                Action::Emit(VoiceEvent::InputSpeakerIdentified { speaker: value, .. }) => {
                    if text.is_some() {
                        return Err("speaker attribution followed final text".into());
                    }
                    speaker = Some(value);
                }
                Action::Emit(VoiceEvent::InputFinal { text: value, .. }) => text = Some(value),
                _ => {}
            }
        }
    }

    let speaker =
        speaker.ok_or_else(|| "silent fixture produced no speaker attribution".to_owned())?;
    Ok(SilentContributionFixture {
        text: text.ok_or_else(|| "silent fixture produced no final text".to_owned())?,
        session_id: session_id.as_str().to_owned(),
        speaker_id: speaker.speaker_id.as_str().to_owned(),
        confidence: speaker.confidence,
    })
}
