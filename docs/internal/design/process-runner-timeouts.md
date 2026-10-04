# Process runner timeouts

Androperator's `NodeProcessRunner.run` and `runShell` enforce the supplied
`timeoutMs` (30 seconds by default). When the timer fires, they retain captured
output, append `Process timed out after <timeoutMs>ms` to stderr, and return
`code: null`. They settle without waiting for the child's `close` event, so a
later zero exit cannot turn a timeout into success.

On macOS and Linux, each `run` starts an owned process group. Timeout sends
`SIGKILL` to that group, including descendants that retain the inherited output
pipes. Descendants that deliberately leave the group are not covered. On Windows,
termination targets the direct child; descendant cleanup is not guaranteed.
In both cases the runner closes its pipes to bound the wait. Killing a process
is best effort, not a rollback of command side effects.

Normal completion retains the tool's exit code and captured output. Missing
executables retain code 127 and the spawn error. Early stdin closure is tolerated
because tools may stop reading or exit before consuming all supplied input.
The streaming/detached `spawn` method is unchanged and has no automatic timeout.

This runner remains owned by Androperator and is supplied to emulator operations
as well as ordinary device commands. Regression tests use real child processes
for ignored termination, descendant pipe retention, input, output and exit codes.
