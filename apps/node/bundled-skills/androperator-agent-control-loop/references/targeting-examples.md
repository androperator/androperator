# Worked targeting examples

These examples illustrate adaptive UI decisions; labels and routes vary by app.

- Offscreen About row: identify the observed scrollable list, scroll within the
  budget, then refresh and match. Do not click an old offscreen position.
- Moved button: expire its previous candidate after navigation, scrolling or an
  interruption. Match again and verify its destination after clicking.
- Duplicate labels: inspect the containing rows and use a supported disambiguating
  selector. Do not choose the first match or turn a node path into a selector.
- Nested label/value: follow explicit parent relationships to the smallest
  supported row. A title wrapper may sit beside the summary within that row;
  adjacent unrelated text is not its value. Verify extracted values with a
  successful independent read. Keep Android OS version and build number separate.
- Popup: observe its meaning and controls before any dismissal. A known harmless
  navigation dismissal may be appropriate; arbitrary acceptance, login, payment
  or permission consent is not recovery authorization.

