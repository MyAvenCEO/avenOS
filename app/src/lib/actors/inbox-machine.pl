% inbox-machine.pl — one intake case, as a state machine.
%
% The inbox skill's per-case lifecycle: arrive, normalize, classify, route.
% Anything the classifier cannot place goes to unknown — never guessed.
% Contracts declare the skill's recipe interfaces: mail and uploads in,
% routed intents out (todo_intent feeds the todos skill, doc(D) the docs
% skill, entity(E) the brain — cross-skill edges unify from these facts).

state(new).
state(normalized).
state(classified).
state(routed).
state(unknown).

initial(new).
terminal(routed).

transition(normalize, new,        normalized).
transition(classify,  normalized, classified).
transition(route,     classified, routed).
transition(puzzle,    classified, unknown).
% a human answer files the unknown after all
transition(resolve,   unknown,    routed).

% ---- contracts: what flows in and out ---------------------------------
requires(mail(M)).
requires(upload(U)).
produces(todo_intent(I)).
produces(doc(D)).
produces(entity(E)).
produces(unknown_item(I)).
