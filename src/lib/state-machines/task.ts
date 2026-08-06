/**
 * Task state machine — docs/07 §7.6.
 *
 * Task state and SLA state are two separate layers. SLA is derived from due_at /
 * warning_at + config and is never user-editable (AGT-07-AC03), so it lives in
 * `deriveSlaState()` rather than in the transition table.
 */

import { SlaState, TaskState } from '@prisma/client';
import { InvalidTransitionError, validationError } from '@/lib/errors';
import type { SlaThreshold } from '@/lib/config';

const TRANSITIONS: Record<TaskState, TaskState[]> = {
  not_started: [TaskState.in_progress, TaskState.waiting, TaskState.cancelled],
  in_progress: [TaskState.waiting, TaskState.done, TaskState.cancelled],
  waiting: [TaskState.in_progress, TaskState.done, TaskState.cancelled],
  done: [],
  cancelled: [],
};

export const ACTIVE_TASK_STATES: TaskState[] = [
  TaskState.not_started,
  TaskState.in_progress,
  TaskState.waiting,
];

export interface TaskTransitionInput {
  /** Required when moving to `waiting`. */
  blocked_reason?: string | null;
  waiting_on?: string | null;
  /** Required when moving to `cancelled`. */
  cancel_reason?: string | null;
  /**
   * True when the task represents an actual approval / upload / filing and that
   * domain mutation has already succeeded. `done` is refused without it.
   */
  domain_prerequisite_met?: boolean;
}

export interface TaskTransitionEffects {
  set_completed_at: boolean;
  clear_blocked_reason: boolean;
  audit: true;
}

export function canTransitionTaskState(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTaskTransitions(from: TaskState): TaskState[] {
  return [...TRANSITIONS[from]];
}

export function assertTaskTransition(
  from: TaskState,
  to: TaskState,
  input: TaskTransitionInput = {},
): TaskTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('task', from, to, 'The task is already in this state.');
  }
  if (!canTransitionTaskState(from, to)) {
    throw new InvalidTransitionError('task', from, to);
  }

  if (to === TaskState.waiting && !input.blocked_reason) {
    throw validationError(
      [
        {
          field: 'blocked_reason',
          code: 'required',
          message: 'Say what this task is waiting on.',
        },
      ],
      'A waiting task must record what it is waiting for.',
    );
  }

  if (to === TaskState.cancelled && !input.cancel_reason) {
    throw validationError(
      [{ field: 'cancel_reason', code: 'required', message: 'A reason is required to cancel.' }],
      // docs/07: "do not use cancel to hide failed work".
      'Cancelling a task requires a reason.',
    );
  }

  if (to === TaskState.done && input.domain_prerequisite_met === false) {
    throw validationError(
      [
        {
          field: 'state',
          code: 'prerequisite_not_met',
          message: 'Complete the underlying action first.',
        },
      ],
      'This task cannot be completed until the action it represents succeeds.',
    );
  }

  return {
    set_completed_at: to === TaskState.done,
    clear_blocked_reason: to === TaskState.in_progress,
    audit: true,
  };
}

/**
 * Derive the SLA layer. Separate from TaskState by design: "SLA: Overdue" and
 * "Task: Waiting" are different signals and must never be collapsed (docs/03 §2).
 */
export function deriveSlaState(
  task: { due_at?: Date | null; warning_at?: Date | null; state: TaskState },
  threshold: SlaThreshold,
  now: Date = new Date(),
): SlaState {
  if (task.state === TaskState.done || task.state === TaskState.cancelled) return SlaState.on_time;
  if (!task.due_at) return SlaState.on_time;

  const dueMs = task.due_at.getTime();
  const nowMs = now.getTime();

  if (nowMs > dueMs) {
    const hoursOverdue = (nowMs - dueMs) / 3_600_000;
    return hoursOverdue >= threshold.escalate_after_hours ? SlaState.escalated : SlaState.overdue;
  }

  const warnAt = task.warning_at?.getTime() ?? dueMs - threshold.warning_in_hours * 3_600_000;
  return nowMs >= warnAt ? SlaState.due_soon : SlaState.on_time;
}

/** due_at / warning_at from the configured threshold — never a hardcoded duration. */
export function scheduleFromThreshold(
  threshold: SlaThreshold,
  from: Date = new Date(),
): { due_at: Date; warning_at: Date } {
  return {
    due_at: new Date(from.getTime() + threshold.due_in_hours * 3_600_000),
    warning_at: new Date(from.getTime() + threshold.warning_in_hours * 3_600_000),
  };
}
