% speaker-machine.pl — the voice, as a state machine.
%
% Preparing (weights download), ready, speaking; silence and interruption
% return to ready from speaking, muting parks the voice without unloading.
% Contracts declare everything the mouth listens for on the mesh.

state(idle).
state(preparing).
state(ready).
state(speaking).
state(muted).
state(error).

initial(idle).

transition(prepare, idle,      preparing).
transition(loaded,  preparing, ready).
transition(speak,   ready,     speaking).
transition(drained, speaking,  ready).
transition(silence, speaking,  ready).
transition(interrupt, speaking, ready).
% text mode parks the voice; the models stay warm
transition(mute,    ready,     muted).
transition(mute,    speaking,  muted).
transition(unmute,  muted,     ready).
% the failure edge — and the way back
transition(fail,    preparing, error).
transition(retry,   error,     preparing).

% ---- contracts: what flows in and out ---------------------------------
requires(delta(D)).
requires(reply(R)).
requires(discard(R)).
requires(interrupted()).
requires(utterance(T)).
