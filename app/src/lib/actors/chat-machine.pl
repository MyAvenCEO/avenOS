% chat-machine.pl — the conversation brain, as a state machine.
%
% The `.pl` is the SSOT inside AND outside: state/transition define the
% turn lifecycle, requires/produces define the actor's contracts — every
% inter-actor edge on the canvas unifies out of these facts.

state(idle).
state(thinking).
state(replying).

initial(idle).

% One turn: an utterance starts the thinking, the first delta opens the
% reply, done closes it. A tool round unsays the streamed placeholder and
% thinks again (discard). Barge-in interrupts from ANY busy state.
transition(utterance, idle,     thinking).
transition(delta,     thinking, replying).
transition(tool_round, replying, thinking).
transition(done,      replying, idle).
transition(interrupt, thinking, idle).
transition(interrupt, replying, idle).
% A follow-up utterance while busy is a barge-in too — same edges.

% ---- contracts: what flows in and out ---------------------------------
requires(utterance(T)).
requires(interrupted()).
produces(delta(D)).
produces(reply(R)).
produces(discard(R)).
