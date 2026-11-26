/**
 * Configurable alerts (Admin → Notifications):
 *   notification_channels — where alerts go: a Slack channel, reached by its
 *     own incoming webhook, or by name through a Slack bot token
 *     (SLACK_BOT_TOKEN), or the default SLACK_WEBHOOK_URL.
 *   alert_rules — one alert: what it watches (a condition on a metric) or a
 *     summary, how often (realtime / daily / weekly / monthly, at a time),
 *     which channel, and what else the message includes. `prompt` keeps the
 *     plain-English description it was built from.
 *   alert_events — per-rule memory of things already reported (e.g. one
 *     large transaction), so each is sent once.
 *   alert_log — every send (or failure), newest first in Admin.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('notification_channels'))) {
    await knex.schema.createTable('notification_channels', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable().unique(); // e.g. #cash-alerts
      t.text('slack_channel'); // channel name/ID for the bot token (defaults to name)
      t.text('webhook_url'); // incoming webhook for this channel (secret)
      t.boolean('is_default').notNullable().defaultTo(knex.raw('false'));
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('alert_rules'))) {
    await knex.schema.createTable('alert_rules', (t) => {
      t.increments('id').primary();
      t.text('name').notNullable();
      t.text('prompt'); // the plain-English description
      t.boolean('enabled').notNullable().defaultTo(knex.raw('true'));
      t.text('kind').notNullable().defaultTo('condition'); // condition | summary
      t.text('cadence').notNullable().defaultTo('daily'); // realtime | daily | weekly | monthly
      t.text('send_time').notNullable().defaultTo('08:00'); // HH:MM local
      t.integer('weekday'); // 0 = Sunday (weekly)
      t.integer('month_day'); // 1-28 (monthly)
      t.text('timezone').notNullable().defaultTo('America/New_York');
      t.text('condition_json'); // { metric, op, threshold, ... }
      t.text('include_json'); // ["cash_position", "top_transactions", …]
      t.text('message'); // optional note at the top of the message
      t.integer('channel_id').nullable().references('id').inTable('notification_channels').onDelete('SET NULL');
      t.boolean('last_state'); // condition result at the last check (realtime: notify on false → true)
      t.timestamp('last_checked_at', { useTz: true });
      t.timestamp('last_sent_at', { useTz: true });
      t.text('last_period'); // the daily/weekly/monthly slot last sent, e.g. 2026-11-26
      t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('alert_events'))) {
    await knex.schema.createTable('alert_events', (t) => {
      t.integer('rule_id').notNullable().references('id').inTable('alert_rules').onDelete('CASCADE');
      t.text('event_key').notNullable(); // e.g. txn:123
      t.timestamp('sent_at', { useTz: true }).defaultTo(knex.fn.now());
      t.primary(['rule_id', 'event_key']);
    });
  }
  if (!(await knex.schema.hasTable('alert_log'))) {
    await knex.schema.createTable('alert_log', (t) => {
      t.increments('id').primary();
      t.integer('rule_id').nullable().references('id').inTable('alert_rules').onDelete('SET NULL');
      t.text('rule_name');
      t.text('channel');
      t.text('trigger'); // realtime | schedule | test
      t.boolean('ok').notNullable();
      t.text('error');
      t.text('text');
      t.timestamp('sent_at', { useTz: true }).defaultTo(knex.fn.now());
      t.index('sent_at', 'idx_alert_log_sent_at');
    });
  }
}

export async function down(knex) {
  for (const t of ['alert_log', 'alert_events', 'alert_rules', 'notification_channels']) await knex.schema.dropTableIfExists(t);
}
