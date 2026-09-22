% chat-machine.pl — one conversation runner's lifecycle and mesh contracts.
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
% thinks again (discard). ChatThreads owns an independent runner per Intent.
% Follow-up utterances queue on that runner. Barge-in silences narration only;
% explicit per-Intent stop cancels the response.
transition(utterance, idle,     thinking).
transition(delta,     thinking, replying).
transition(tool_round, replying, thinking).
transition(done,      replying, idle).
transition(interrupt, thinking, thinking).
transition(interrupt, replying, replying).
transition(stop,      thinking, idle).
transition(stop,      replying, idle).

% ---- contracts: what flows in and out ---------------------------------
requires(utterance(T)).
requires(interrupted()).
produces(delta(D)).
produces(reply(R)).
produces(discard(R)).
