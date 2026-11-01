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
  /** Bumped on every dispatch / undo / redo, so a reader can tell "something changed since". */
  private _seq = 0;
  /** Bumped on clear (a new or loaded document): changes across epochs aren't edits. */
  private _epoch = 0;
  private _lastKind: 'do' | 'undo' | 'redo' = 'do';
  private _last: Command | null = null;
  /** Entries ever pushed (merges don't count) and undo/redo/clear moves — for checkpoints. */
  private pushes = 0;
  private travels = 0;

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
  get seq(): number {
    return this._seq;
  }
  get epoch(): number {
    return this._epoch;
  }
  /**
   * The most recent step: what kind it was, the command's label ("Delete", "Edit
   * device"), and the command itself (so a caller can ask what KIND of step it was
   * without matching label text).
   */
  get last(): { kind: 'do' | 'undo' | 'redo'; label: string; command: Command | null } {
    return { kind: this._lastKind, label: this._last?.label ?? '', command: this._last };
  }
  /**
   * True while the newest entry can still absorb more of the same edit (typing in a
   * field before blur) — a half-typed value isn't the user's decision yet.
   */
  get editOpen(): boolean {
    return !this.breakCoalesce && !!this.past[this.past.length - 1]?.mergeWith;
  }

  /** A point to revert to (see `revertTo`). Take it when no edit is open. */
  checkpoint(): { pushes: number; travels: number } {
    return { pushes: this.pushes, travels: this.travels };
  }

  /**
   * Take back every entry pushed since `cp`, as if they never happened: undone in
   * reverse order and NOT offered to redo. Refuses (false) when history moved
   * another way since — an undo/redo/clear, or entries trimmed past the limit.
   */
  revertTo(cp: { pushes: number; travels: number }, state: ModelState): boolean {
    const n = this.pushes - cp.pushes;
    if (this.travels !== cp.travels || n <= 0 || n > this.past.length) return false;
    let first: Command | null = null;
    for (let i = 0; i < n; i++) {
      const command = this.past.pop()!;
      command.undo(state);
      first = command;
    }
    this.pushes = cp.pushes;
    this.breakCoalesce = true;
    this.mark('undo', first);
    return true;
  }

  private mark(kind: 'do' | 'undo' | 'redo', command: Command | null): void {
    this._seq++;
    this._lastKind = kind;
    this._last = command;
  }

  /** Apply a command and record it, coalescing with the previous entry if possible. */
  dispatch(command: Command, state: ModelState): void {
    command.apply(state);
    this.future = [];
    this.mark('do', command);

    const last = this.past[this.past.length - 1];
    if (!this.breakCoalesce && last?.mergeWith) {
      const merged = last.mergeWith(command);
      if (merged) {
        if (merged.isIdentity?.()) {
          // The coalesced entry collapsed to a no-op (an Escape-cancelled
          // drag restored its origin): drop it, else it eats the next undo.
          // It was a push, so it stops counting as one — or a later revertTo
          // would reach past its checkpoint into an unrelated earlier edit.
          this.past.pop();
          this.pushes--;
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
    this.pushes++;
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
    this.travels++;
    this.mark('undo', command);
    this.future.push(command);
    this.breakCoalesce = true;
    return true;
  }

  redo(state: ModelState): boolean {
    const command = this.future.pop();
    if (!command) return false;
    command.apply(state);
    this.travels++;
    this.mark('redo', command);
    this.past.push(command);
    this.breakCoalesce = true;
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.breakCoalesce = false;
    this._epoch++;
    this.travels++;
  }
}
