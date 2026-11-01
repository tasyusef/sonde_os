/**
 * Cells for a table on the page ground (no box around it): the outer
 * columns sit flush with the page gutter. `first:`/`last:` go by markup,
 * not by what's shown, so a column that's last only below a breakpoint
 * adds its own `max-sm:pr-0` (or `max-lg:pr-0`).
 */
const pad = "px-3 py-row first:pl-0 last:pr-0";

/** A body cell. It sets the data size itself so every cell's line box
 *  matches: an inline link in a cell otherwise sits on the body's taller
 *  line and drops below its row's plain text. */
export const cell = `${pad} text-cell`;
export const thClass = `${pad} font-display text-caps uppercase tracking-header text-muted`;
