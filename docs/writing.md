# Repository writing standard

Status: authoritative

Use these rules for repository documentation, runbooks, architectural papers, error
messages, and operator-facing command output.

## Start with the reader's decision

- Name the audience and the outcome in the opening paragraph.
- Put the shortest safe path before explanation and alternatives.
- Introduce a prerequisite when the reader first needs it. Put shared prerequisites
  up front only when every path depends on them.
- Prefer concrete verbs: _run_, _verify_, _restore_, _reject_. Avoid vague verbs such
  as _handle_ or _manage_ when a more precise one exists.

## Make authority visible

- Give one document ownership of each operational process. Other documents link to
  it instead of copying its commands or secret lists.
- Mark normative documents `Status: authoritative`. Mark proposals and historical
  records honestly, and remove them when they no longer aid a current decision.
- Describe implemented behavior in the present tense. Label planned behavior and
  unsupported paths explicitly; never turn intent into an operational claim.
- Include stable, descriptive headings. Link to the narrowest useful section rather
  than to the top of a long document.

## Write procedures that fail safely

- State the success condition and the safe stopping point.
- Put commands in copyable blocks and say where to run them.
- Name destructive effects before the command. Never hide data deletion in a generic
  “cleanup” step.
- Separate required steps from optional diagnostics and background explanation.
- Name secrets by identifier and purpose, never by value. State where each secret
  belongs and who or what consumes it.

## Keep prose easy to scan

- Use short sentences and one idea per paragraph.
- Prefer a small table when readers need to compare several exact choices.
- Use lists for real sequences or sets, not for every paragraph.
- Expand an abbreviation on first use. Avoid internal project history unless it
  changes the reader's action.
- Use `next` for the supported deployment target, `production` for the production
  target, and “local” only for resources on the developer's machine.

## Keep documentation correct

- Update the owning handbook section in the same change as a command, workflow,
  secret, public endpoint, or recovery behavior.
- Run the documented command or identify it as an example that was not executed.
- Check relative links and search for references before deleting or renaming a page.
- Do not preserve stale instructions as redirects. Git history is the archive.
