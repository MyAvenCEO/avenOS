% listener-machine.pl — the ears, as a state machine.
%
% Full lifecycle including the failure edges: the microphone can be denied,
% the model load can fail, and a running graph can be stopped from any live
% state. Contracts declare what the ears emit into the mesh.

state(idle).
state(preparing).
state(listening).
state(hearing).
state(denied).
state(error).

initial(idle).

transition(start,     idle,      preparing).
transition(ready,     preparing, listening).
transition(speech,    listening, hearing).
transition(utterance, hearing,   listening).
transition(stop,      preparing, idle).
transition(stop,      listening, idle).
transition(stop,      hearing,   idle).
% the failure edges — and the ways back
transition(deny,      preparing, denied).
transition(fail,      preparing, error).
transition(fail,      listening, error).
transition(retry,     error,     preparing).
transition(stop,      error,     idle).

% ---- contracts: what flows in and out ---------------------------------
produces(utterance(T)).
produces(interrupted()).
