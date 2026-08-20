% todo-machine.pl — the todo lifecycle, as a formal state machine.
%
% ONE source of truth, colocated with the actor primitives. The Skills
% canvas renders these facts AND the live todo reducer gates every status
% change through them (injected into the QuickJS sandbox as data — behavior
% stays data, flow stays data). States ARE the kanban columns; transitions
% ARE the only legal moves; cycle/2 is the board button's walk order.
%
% Fact-only Prolog: parsed by machine.ts and answered by unification
% (term.ts). Keep every clause a ground fact; no list literals.

% ---- states: the three kanban columns ---------------------------------
state(open).
state(doing).
state(done).

initial(open).
terminal(done).

% 'none' is the void before a task exists; 'deleted' the void after. Both
% are pseudo-states — reachable by a transition, never shown as a column.

% ---- transitions: transition(Event, From, To) -------------------------
% The legal moves, and ONLY these. Note there is no done -> doing: a
% finished task reopens to open, it does not slip back into progress.
transition(create,     none,  open).
transition(start,      open,  doing).
transition(finish,     doing, done).
transition(complete,   open,  done).
transition(reopen,     done,  open).
transition(delete,     open,  deleted).
transition(delete,     doing, deleted).
transition(delete,     done,  deleted).
transition(clear_done, done,  deleted).

% ---- cycle: the board button's forward walk (each edge is a transition) -
cycle(open,  doing).
cycle(doing, done).
cycle(done,  open).

% ---- guards: a transition may carry a condition -----------------------
guard(clear_done, status(done)).

% ---- contracts: what flows in and out ---------------------------------
% A create intent may come from anywhere — the voice, the chat, or the
% inbox skill's router: the cross-skill recipe edge unifies right here.
requires(todo_intent(I)).
produces(todo(T)).

% ---- views over the same machine --------------------------------------
view(list).
view(board).

shows(list,  open).
shows(list,  doing).
shows(list,  done).
shows(board, open).
shows(board, doing).
shows(board, done).
