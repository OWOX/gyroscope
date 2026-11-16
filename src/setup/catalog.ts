import { Divide, Gauge, Settings2, ShieldCheck, Target, Users } from 'lucide-react';
import type { BlockInfo, Severity } from './types';

export const BLOCKS: BlockInfo[] = [
  { id: 'goal', title: 'Goal & Core Classes', question: 'What number does the business live by, and what is it made of?', why: 'Every other setting is judged against it, and the core classes are drawn around it.', icon: Target },
  { id: 'teams', title: 'Contexts', question: 'Which contexts own a part of the goal?', why: 'To group the canvas by context and judge each on its own number.', icon: Users },
  { id: 'metrics', title: 'Metrics', question: 'Which numbers should each card show?', why: 'So every card reads at a glance.', icon: Gauge },
  { id: 'ratios', title: 'Ratio Metrics', question: 'How well does one step turn into the next?', why: 'It shows how well one step turns into the next.', icon: Divide },
  { id: 'checks', title: 'Data Checks', question: 'Can Gyroscope read what the settings point at?', why: 'A setting that points at missing data shows nothing.', icon: ShieldCheck },
  { id: 'housekeeping', title: 'Housekeeping', question: 'Is Gyroscope itself set up?', why: 'So recommendations and card colors work as you expect.', icon: Settings2 },
];

interface Copy { title: string; question: string; why: string; severity: Severity }
const c = (title: string, question: string, why: string, severity: Severity): Copy => ({ title, question, why, severity });

export const COPY: Record<string, Copy> = {
  'goal.metric': c('Business Critical Number', 'What is the main business goal?', 'Every card is judged by how it moves this number.', 'error'),
  'goal.date': c('Critical Number Date', 'Which date does each value belong to?', 'To show the trend line and tell whether the number grows or declines.', 'error'),
  'goal.aggregation': c('How Values Add Up', 'Is it a total over the period, or a level on a day?', 'So a week or a quarter shows the right number.', 'warning'),
  'goal.plan': c('Critical Number Plan', 'What should the number be?', 'To show whether the business is on track.', 'warning'),
  'goal.shape': c('How the Plan Is Written', 'Is the plan a daily amount, a running total, or a level?', 'So the fact and the plan are compared for the same day.', 'warning'),
  'goal.description': c('Goal in Project Description', 'Does the OWOX project description name the critical number?', 'So people and OWOX AI read the same goal.', 'notice'),
  'core.classes': c('Core Classes', 'Who buys, what is bought, and where do they come from?', 'These are drawn around the goal and show how the business fits together.', 'warning'),
  'teams.exist': c('Contexts That Move the Goal', 'Which contexts own a part of the goal?', 'To group the canvas by context.', 'notice'),
  'team.metric': c('{Team} Critical Number', 'Which number shows {Team} is doing its job?', 'To judge each context on its own number.', 'warning'),
  'team.plan': c('{Team} Plan', "What should {Team}'s number be?", 'To show whether the context is on track.', 'notice'),
  'team.description': c('{Team} Number in Context Description', 'Does the context description name its number?', 'So the context and OWOX AI read the same number.', 'notice'),
  'class.key': c('{Class} Headline Number', 'Which number should this class show first?', 'The card shows it large, with its trend.', 'warning'),
  'class.shown': c('{Class} Numbers on the Card', 'Which other numbers should the card show?', 'The card shows up to 3 small numbers under the headline.', 'notice'),
  'metric.plan': c('{Metric} Plan', 'What should {Metric} be?', 'To show whether it is on track.', 'notice'),
  'metric.format': c('{Metric} Format', 'Is it a count, a share or money?', 'So it reads as 1,200, 4% or $1,200.', 'notice'),
  ratio: c('{A} per {B}', 'Should the canvas show {A} per {B}, for example Orders per Session?', 'It shows how well one step turns into the next.', 'notice'),
  'check.goal.access': c('Goal Data Mart Access', 'Is the goal Data Mart published and can you access it?', 'Without it the canvas has no number to show.', 'error'),
  'check.goal.pk': c('Goal Data Mart Primary Key', 'Does the goal Data Mart have a primary key?', 'Without a key its rows cannot be counted or joined.', 'error'),
  'check.core.pk': c('{Class} Primary Key', 'Does {Class} have a single-column primary key?', 'A core entity needs one key to be counted and joined.', 'warning'),
  'check.core.toGoal': c('{Class} Connection to the Goal', 'Does {Class} connect to the goal Data Mart?', 'An unconnected entity cannot be drawn around the goal.', 'warning'),
  'check.access': c('Data Mart Access', 'Can you access every Data Mart the settings use?', 'A Data Mart you cannot read shows no numbers.', 'warning'),
  'ai.credential': c('AI Assistant', 'Is an AI model connected to Gyroscope?', 'Without it, recommendations come from name rules only.', 'warning'),
  threshold: c('On-Track Margin', 'How far from plan still counts as near?', 'It decides when a card turns yellow or red.', 'notice'),
};

/** Replaces `{Name}` placeholders from `vars`; an unknown one stays as written. */
export const fill = (text: string, vars: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
