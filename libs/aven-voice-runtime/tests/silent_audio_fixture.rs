#![cfg(feature = "silent-audio-e2e")]

use aven_voice_runtime::silent_fixture::generate_silent_contribution_fixture;

#[test]
fn in_memory_pcm_reaches_a_semantic_speaker_attributed_final() {
    let fixture = generate_silent_contribution_fixture().unwrap();
    assert_eq!(fixture.text, "Guten Tag vom stillen Audiotest");
    assert_eq!(fixture.speaker_id, "speaker-1");
    assert_eq!(fixture.confidence, 1.0);
    assert!(!fixture.session_id.is_empty());
}
