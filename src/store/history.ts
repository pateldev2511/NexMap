/**
 * Undo/redo history (eng review DA-A1).
 *
 * - Single writer: ALL model mutation goes through `dispatch`. Nothing mutates
 *   ModelState directly (DA-A2). This is what keeps undo correct.
 * - Coalescing: consecutive mergeable commands (e.g. a drag's many moves) collapse
 *   into one entry via Command.mergeWith.
 * - Bounded: the past stack is capped so a long session can't exhaust memory.
 * - A new dispatch clears the redo stack (standard linear history).
 */
import type { Command } from './commands';
import type { ModelState } from './modelState';

const DEFAULT_LIMIT = 200;

export class History {
  private past: Command[] = [];
  private future: Command[] = [];
  private readonly limit: number;
  /** When true, the next dispatch will not coalesce with the previous entry. */
  private breakCoalesce = false;

  constructor(limit: number = DEFAULT_LIMIT) {
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get depth(): number {
    return this.past.length;
  }

  /** Apply a command and record it, coalescing with the previous entry if possible. */
  dispatch(command: Command, state: ModelState): void {
    command.apply(state);
    this.future = [];

    const last = this.past[this.past.length - 1];
    if (!this.breakCoalesce && last?.mergeWith) {
      const merged = last.mergeWith(command);
      if (merged) {
        if (merged.isIdentity?.()) {
          // The coalesced entry collapsed to a no-op (an Escape-cancelled
          // drag restored its origin): drop it, else it eats the next undo.
          this.past.pop();
          this.breakCoalesce = true;
        } else {
          this.past[this.past.length - 1] = merged;
        }
        return;
      }
    }

    if (command.isIdentity?.()) return; // no-op command: nothing to record
    this.breakCoalesce = false;
    this.past.push(command);
    if (this.past.length > this.limit) this.past.shift();
  }

  /**
   * Force the next dispatch to start a fresh history entry instead of coalescing.
   * Call on pointer-up / blur so the next drag or edit is independently undoable.
   */
  commitCoalesceBoundary(): void {
    this.breakCoalesce = true;
  }

  undo(state: ModelState): boolean {
    const command = this.past.pop();
    if (!command) return false;
    command.undo(state);
    this.future.push(command);
    this.breakCoalesce = true;
    return true;
  }

  redo(state: ModelState): boolean {
    const command = this.future.pop();
    if (!command) return false;
    command.apply(state);
    this.past.push(command);
    this.breakCoalesce = true;
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.breakCoalesce = false;
  }
}
