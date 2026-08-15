/* Merged message catalog. Each domain file owns the strings for its pages so
 * parallel edits never collide; add new domains to the merge below. */
import { shell } from './shell';
import { dashboard } from './dashboard';
import { timeline } from './timeline';
import { projects } from './projects';
import { insights } from './insights';
import { run } from './run';
import { misc } from './misc';

export interface MsgEntry {
  en: string;
  fr: string;
}

export const MESSAGES = {
  ...shell,
  ...dashboard,
  ...timeline,
  ...projects,
  ...insights,
  ...run,
  ...misc,
} as const;

export type MsgKey = keyof typeof MESSAGES;
