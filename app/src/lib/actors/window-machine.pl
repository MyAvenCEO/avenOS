% window-machine.pl — a view window's visibility, as a state machine.
%
% The 2nd actor to carry its own `.pl` (after todo): proof that the statechart
% is the universal primitive, not a todo special case. Trivial on purpose —
% two states, two moves — the point is that ANY actor declares its flow this
% way, loaded by the same machine.ts, drawn by the same canvas.

state(shown).
state(hidden).

initial(hidden).

transition(show, hidden, shown).
transition(hide, shown, hidden).

cycle(hidden, shown).
cycle(shown, hidden).
