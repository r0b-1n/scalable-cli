//! Renders cron/systemd-timer/launchd/Task-Scheduler artifacts from an
//! `AgentDefinition.schedule` string (fix F11). `sc` remains a one-shot
//! synchronous binary with no in-process scheduler — this module only
//! prints the snippet an operator installs themselves (`crontab -e`,
//! `systemctl --user enable --now`, `launchctl load`, `schtasks /create`).
//!
//! `cron_expr` is always a standard 5-field `minute hour day-of-month month
//! day-of-week` string — the same syntax `crontab(5)` accepts — never a
//! `@daily`-style macro or a 6-field (with seconds) variant. Every quoting
//! or field-translation routine here is deliberately conservative: rather
//! than emit a subtly wrong crontab line, unit file, plist or XML document,
//! it refuses (via `Err`) any input it cannot render exactly.

use std::collections::BTreeSet;

use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ScheduleFormat {
    Cron,
    SystemdTimer,
    Launchd,
    TaskScheduler,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ScheduleArtifact {
    pub agent_id: String,
    pub format: ScheduleFormat,
    pub snippet: String,
    pub note: String,
}

/// `cron_expr` is `AgentDefinition.schedule` — an opaque, operator-authored
/// string never interpreted by an in-process scheduler; this function only
/// translates it into the artifact `format` asks for. The binary path
/// invoked is `std::env::current_exe()` (falling back to the bare `sc` on
/// the rare host where that call fails), matching how an installed
/// `sc` would actually be found by the scheduler that runs this snippet.
pub(crate) fn export(agent_id: &str, cron_expr: &str, format: ScheduleFormat) -> Result<ScheduleArtifact> {
    let cron_expr = cron_expr.trim();
    if cron_expr.is_empty() {
        bail!("Agent input invalid: agent '{agent_id}' has no schedule configured");
    }
    reject_control_chars("agent id", agent_id)?;
    let fields = parse_cron(cron_expr)?;
    let bin_path = resolve_binary_path();
    reject_control_chars("resolved binary path", &bin_path)?;

    let (snippet, note) = match format {
        ScheduleFormat::Cron => (
            render_cron(agent_id, cron_expr, &bin_path),
            "sc has no in-process scheduler; install this line yourself (crontab -e) or use the systemd-timer/launchd/task-scheduler format.".to_string(),
        ),
        ScheduleFormat::SystemdTimer => (
            render_systemd_timer(agent_id, &fields, &bin_path)?,
            format!(
                "sc has no in-process scheduler; save the two units above as sc-agent-{agent_id}.service and sc-agent-{agent_id}.timer under /etc/systemd/system/ (or ~/.config/systemd/user/ for a --user timer), then run `systemctl daemon-reload && systemctl enable --now sc-agent-{agent_id}.timer` (add --user to both for a user timer)."
            ),
        ),
        ScheduleFormat::Launchd => (
            render_launchd(agent_id, &fields, &bin_path)?,
            format!(
                "sc has no in-process scheduler; save this as ~/Library/LaunchAgents/com.sc.agent.{agent_id}.plist and run `launchctl load ~/Library/LaunchAgents/com.sc.agent.{agent_id}.plist` (or `launchctl bootstrap gui/$UID ...` on newer macOS)."
            ),
        ),
        ScheduleFormat::TaskScheduler => (
            render_task_scheduler(agent_id, &fields, &bin_path)?,
            format!(
                "sc has no in-process scheduler; save this as sc-agent-{agent_id}.xml and run `schtasks /create /tn \"sc-agent-{agent_id}\" /xml sc-agent-{agent_id}.xml` (or import it via the Task Scheduler GUI)."
            ),
        ),
    };

    Ok(ScheduleArtifact { agent_id: agent_id.to_string(), format, snippet, note })
}

fn resolve_binary_path() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            let rendered = path.to_string_lossy().into_owned();
            (!rendered.is_empty()).then_some(rendered)
        })
        .unwrap_or_else(|| "sc".to_string())
}

/// Every format here renders a single-line crontab entry, a single-line
/// `ExecStart=`/`Arguments=` value, or an XML document — none of which can
/// carry an embedded newline without corrupting the surrounding file (a
/// crontab newline in particular would splice in a second, attacker-
/// controlled job entry). No legal agent id or resolved binary path should
/// ever contain one, but this is cheap to check and the one class of input
/// none of the per-format quoting below is designed to survive.
fn reject_control_chars(label: &str, value: &str) -> Result<()> {
    if value.contains(['\n', '\r']) {
        bail!("Agent input invalid: {label} must not contain a newline or carriage return");
    }
    Ok(())
}

/// Wraps `s` in single quotes for a POSIX `/bin/sh` command line — the
/// shell every mainstream cron implementation hands the command field to.
/// Single-quoting is used unconditionally (never "only when needed") since
/// that leaves nothing for the shell to interpret: every byte other than
/// `'` itself is literal inside single quotes, including `$`, backticks,
/// spaces, and other single-quoted segments' delimiters.
fn shell_single_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// `crontab(5)`: an unescaped `%` in the command field is turned into a
/// newline, with everything after the first one sent to the command as
/// standard input — a rule cron applies to the raw command text before any
/// shell ever sees it, so it applies just as much inside single quotes as
/// outside them. Every literal `%` therefore has to be escaped as `\%`
/// regardless of where it falls in the (already shell-quoted) line.
fn escape_cron_percent(line: &str) -> String {
    line.replace('%', "\\%")
}

fn render_cron(agent_id: &str, cron_expr: &str, bin_path: &str) -> String {
    let line = format!(
        "{cron_expr} {} agent run start --agent {} --detach >> /var/log/sc-agent.log 2>&1",
        shell_single_quote(bin_path),
        shell_single_quote(agent_id),
    );
    escape_cron_percent(&line)
}

/// Quotes `s` as a single `systemd.service(5)` `ExecStart=` argument: the
/// unit file parser's own quoting is C-like, not POSIX-shell, so `\` and
/// `"` are backslash-escaped and `$` is doubled (`$$`) to stop it being
/// read as the start of a `${VAR}`/`$VAR` specifier expansion.
fn systemd_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '$' => out.push_str("$$"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

/// Escapes `s` for use as XML text content or a quoted-attribute value —
/// the five characters the XML spec requires an escape for. Every
/// character is inspected exactly once, so there is no risk of the classic
/// double-escaping bug where a later `&` substitution re-mangles an
/// entity a substitution pass just produced.
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Quotes `s` as one argument inside a Windows `<Arguments>` command-line
/// string, using the same backslash-run/double-quote algorithm the MSVC
/// runtime's `CommandLineToArgvW` decodes: a run of `n` backslashes
/// immediately before a `"` is doubled (plus one more to escape that `"`),
/// and a trailing run of `n` backslashes right before the closing quote
/// this function adds is doubled so it can never be read as escaping that
/// closing quote.
fn win_quote(s: &str) -> String {
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for ch in s.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                for _ in 0..backslashes * 2 + 1 {
                    out.push('\\');
                }
                out.push('"');
                backslashes = 0;
            }
            _ => {
                for _ in 0..backslashes {
                    out.push('\\');
                }
                backslashes = 0;
                out.push(ch);
            }
        }
    }
    for _ in 0..backslashes * 2 {
        out.push('\\');
    }
    out.push('"');
    out
}

/// A parsed 5-field cron expression: every field expanded to its sorted,
/// deduplicated set of matching integers, plus whether each field's
/// original text was a bare `*` — `crontab(5)`'s day-of-month/day-of-week
/// OR rule (§`ensure_single_calendar_family`) keys off that literal text,
/// not off whether the expanded set happens to cover the whole range.
#[derive(Debug)]
struct CronFields {
    minutes: Vec<u32>,
    hours: Vec<u32>,
    doms: Vec<u32>,
    months: Vec<u32>,
    /// Normalized so Sunday is always `0` — cron accepts `7` as an alias
    /// for `0`, but nothing downstream should have to know that.
    dows: Vec<u32>,
    minute_is_star: bool,
    hour_is_star: bool,
    dom_is_star: bool,
    month_is_star: bool,
    dow_is_star: bool,
}

fn parse_cron(cron_expr: &str) -> Result<CronFields> {
    let parts: Vec<&str> = cron_expr.split_whitespace().collect();
    let [minute, hour, dom, month, dow] = <[&str; 5]>::try_from(parts.as_slice()).map_err(|_| {
        anyhow!(
            "Agent input invalid: schedule '{cron_expr}' must have exactly 5 whitespace-separated fields (minute hour day-of-month month day-of-week)"
        )
    })?;
    Ok(CronFields {
        minutes: parse_field(minute, 0, 59, "minute")?,
        hours: parse_field(hour, 0, 23, "hour")?,
        doms: parse_field(dom, 1, 31, "day-of-month")?,
        months: parse_field(month, 1, 12, "month")?,
        dows: parse_dow_field(dow)?,
        minute_is_star: minute == "*",
        hour_is_star: hour == "*",
        dom_is_star: dom == "*",
        month_is_star: month == "*",
        dow_is_star: dow == "*",
    })
}

/// Expands one cron field — `*`, a number, a range (`a-b`), a step
/// (`*/n` or `a-b/n`), or a comma list of any of those — into its sorted,
/// deduplicated set of matching integers within `min..=max`.
fn parse_field(field: &str, min: u32, max: u32, label: &str) -> Result<Vec<u32>> {
    let mut values = BTreeSet::new();
    for part in field.split(',') {
        let (range_part, step): (&str, u32) = match part.split_once('/') {
            Some((r, step_str)) => {
                let step: u32 = step_str.parse().map_err(|_| {
                    anyhow!(
                        "Agent input invalid: schedule {label} field '{field}' has a non-numeric step '{step_str}'"
                    )
                })?;
                if step == 0 {
                    bail!("Agent input invalid: schedule {label} field '{field}' has a zero step");
                }
                (r, step)
            }
            None => (part, 1),
        };
        let (lo, hi) = if range_part == "*" {
            (min, max)
        } else if let Some((a, b)) = range_part.split_once('-') {
            let lo: u32 = a.parse().map_err(|_| {
                anyhow!(
                    "Agent input invalid: schedule {label} field '{field}' has a non-numeric range start '{a}'"
                )
            })?;
            let hi: u32 = b.parse().map_err(|_| {
                anyhow!(
                    "Agent input invalid: schedule {label} field '{field}' has a non-numeric range end '{b}'"
                )
            })?;
            if lo > hi {
                bail!(
                    "Agent input invalid: schedule {label} field '{field}' has a reversed range ('{a}' > '{b}')"
                );
            }
            (lo, hi)
        } else {
            let v: u32 = range_part.parse().map_err(|_| {
                anyhow!(
                    "Agent input invalid: schedule {label} field '{field}' is not '*', a number, a range, or a step"
                )
            })?;
            (v, v)
        };
        if lo < min || hi > max {
            bail!("Agent input invalid: schedule {label} field '{field}' is out of range {min}-{max}");
        }
        let mut v = lo;
        while v <= hi {
            values.insert(v);
            v += step;
        }
    }
    if values.is_empty() {
        bail!("Agent input invalid: schedule {label} field '{field}' matches no values");
    }
    Ok(values.into_iter().collect())
}

/// Like [`parse_field`] over cron's day-of-week range (`0`-`7`), then folds
/// the `7 == Sunday` alias down to `0` so every consumer only ever sees
/// `0..=6`.
fn parse_dow_field(field: &str) -> Result<Vec<u32>> {
    let raw = parse_field(field, 0, 7, "day-of-week")?;
    let normalized: BTreeSet<u32> = raw.into_iter().map(|v| if v == 7 { 0 } else { v }).collect();
    Ok(normalized.into_iter().collect())
}

/// `crontab(5)`'s day-of-month/day-of-week rule: when both fields are
/// restricted (neither is a bare `*`), cron runs the command when *either*
/// matches, not when both do. systemd's `OnCalendar=`, a launchd
/// `StartCalendarInterval` dict, and a Windows `CalendarTrigger` each
/// combine their day-of-month and day-of-week filters with AND instead, so
/// this combination has no faithful single-expression translation into any
/// of those three formats — refusing it loudly is preferable to silently
/// installing a schedule that fires on a different set of days than the
/// original cron string.
fn ensure_single_calendar_family(fields: &CronFields, format_name: &str) -> Result<()> {
    if !fields.dom_is_star && !fields.dow_is_star {
        bail!(
            "Agent input invalid: schedule restricts both day-of-month and day-of-week; cron's OR semantics for that combination has no direct equivalent in {format_name}'s calendar syntax — restrict only one of the two, or use the cron format instead"
        );
    }
    Ok(())
}

const SYSTEMD_WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

fn join_numbers_padded(values: &[u32]) -> String {
    values.iter().map(|v| format!("{v:02}")).collect::<Vec<_>>().join(",")
}

/// Builds one `systemd.time(7)` calendar expression for `fields`. Every
/// restricted field becomes a comma list (systemd accepts one natively, so
/// there is no need to re-derive a prettier range/step form), and an
/// unrestricted field becomes `*` — never expanded to its full set, which
/// would be correct but unreadable. `ensure_single_calendar_family` having
/// already run guarantees at most one of the day-of-month/day-of-week
/// components is present, so a single expression is always enough.
fn on_calendar_expr(fields: &CronFields) -> String {
    let weekday = if fields.dow_is_star {
        "*".to_string()
    } else {
        fields.dows.iter().map(|&d| SYSTEMD_WEEKDAYS[d as usize]).collect::<Vec<_>>().join(",")
    };
    let month = if fields.month_is_star { "*".to_string() } else { join_numbers_padded(&fields.months) };
    let day = if fields.dom_is_star { "*".to_string() } else { join_numbers_padded(&fields.doms) };
    let hour = if fields.hour_is_star { "*".to_string() } else { join_numbers_padded(&fields.hours) };
    let minute = if fields.minute_is_star { "*".to_string() } else { join_numbers_padded(&fields.minutes) };
    if weekday == "*" {
        format!("*-{month}-{day} {hour}:{minute}:00")
    } else {
        format!("{weekday} *-{month}-{day} {hour}:{minute}:00")
    }
}

/// Renders a `.service`/`.timer` pair as one text blob, each file marked
/// off by a leading `#` comment naming it — `ScheduleArtifact` carries a
/// single `snippet` string, so the operator splits this at the comments
/// when saving the two files.
fn render_systemd_timer(agent_id: &str, fields: &CronFields, bin_path: &str) -> Result<String> {
    ensure_single_calendar_family(fields, "systemd-timer")?;
    let on_calendar = on_calendar_expr(fields);
    let unit_name = format!("sc-agent-{agent_id}");
    let exec_start =
        format!("ExecStart={} agent run start --agent {} --detach", systemd_quote(bin_path), systemd_quote(agent_id));

    let lines: Vec<String> = vec![
        format!("# {unit_name}.service — install under /etc/systemd/system/ (or ~/.config/systemd/user/ for a --user timer)"),
        "[Unit]".to_string(),
        format!("Description=Scheduled run of sc agent '{agent_id}'"),
        String::new(),
        "[Service]".to_string(),
        "Type=oneshot".to_string(),
        exec_start,
        String::new(),
        format!("# {unit_name}.timer — save next to the service unit above, in the same directory"),
        "[Unit]".to_string(),
        format!("Description=Schedule for sc agent '{agent_id}'"),
        String::new(),
        "[Timer]".to_string(),
        format!("OnCalendar={on_calendar}"),
        "Persistent=true".to_string(),
        String::new(),
        "[Install]".to_string(),
        "WantedBy=timers.target".to_string(),
    ];
    Ok(lines.join("\n") + "\n")
}

/// `StartCalendarInterval` axis order used by [`calendar_axes`] and
/// [`expand_calendar_dicts`], matching launchd's own key names.
const CALENDAR_KEYS: [&str; 5] = ["Minute", "Hour", "Day", "Month", "Weekday"];

/// A defensive ceiling on how many `StartCalendarInterval` dicts
/// [`render_launchd`] will emit — comfortably above any realistic trading-
/// agent schedule (a full weekday list is 5, a full day-of-month list is
/// 31), but low enough to refuse a pathological input (e.g. both minute and
/// hour left as dense lists) instead of writing out a multi-thousand-entry
/// plist.
const LAUNCHD_COMBINATION_CAP: usize = 256;

/// Per-field axis for the `StartCalendarInterval` cartesian product: `None`
/// means the field was unrestricted (`*`) and is omitted from every dict —
/// a dict with a key absent matches any value for it — while `Some` carries
/// the field's expanded value set.
fn calendar_axes(fields: &CronFields) -> [Option<&[u32]>; 5] {
    [
        (!fields.minute_is_star).then_some(fields.minutes.as_slice()),
        (!fields.hour_is_star).then_some(fields.hours.as_slice()),
        (!fields.dom_is_star).then_some(fields.doms.as_slice()),
        (!fields.month_is_star).then_some(fields.months.as_slice()),
        (!fields.dow_is_star).then_some(fields.dows.as_slice()),
    ]
}

/// launchd's `StartCalendarInterval` dict keys each take a single integer,
/// unlike cron's/systemd's comma lists, and the array of dicts is OR'd
/// together — so a field with more than one value has to become several
/// dicts, one per value, crossed with every other restricted field's
/// values (a field left as `*` contributes no key to any dict at all).
fn expand_calendar_dicts(axes: &[Option<&[u32]>; 5]) -> Vec<Vec<(&'static str, u32)>> {
    let mut dicts: Vec<Vec<(&'static str, u32)>> = vec![Vec::new()];
    for i in 0..CALENDAR_KEYS.len() {
        let Some(values) = axes[i] else { continue };
        let key = CALENDAR_KEYS[i];
        let mut next = Vec::with_capacity(dicts.len() * values.len());
        for dict in &dicts {
            for &v in values {
                let mut entry = dict.clone();
                entry.push((key, v));
                next.push(entry);
            }
        }
        dicts = next;
    }
    dicts
}

fn render_launchd(agent_id: &str, fields: &CronFields, bin_path: &str) -> Result<String> {
    ensure_single_calendar_family(fields, "launchd")?;
    let axes = calendar_axes(fields);
    let dicts = expand_calendar_dicts(&axes);
    if dicts.len() > LAUNCHD_COMBINATION_CAP {
        bail!(
            "Agent input invalid: schedule expands to {} launchd StartCalendarInterval entries, over this tool's safety cap of {LAUNCHD_COMBINATION_CAP} — simplify the schedule or use the cron/systemd-timer format instead",
            dicts.len()
        );
    }

    let mut lines: Vec<String> = vec![
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
        "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">".to_string(),
        "<plist version=\"1.0\">".to_string(),
        "<dict>".to_string(),
        "    <key>Label</key>".to_string(),
        format!("    <string>{}</string>", xml_escape(&format!("com.sc.agent.{agent_id}"))),
        "    <key>ProgramArguments</key>".to_string(),
        "    <array>".to_string(),
        format!("        <string>{}</string>", xml_escape(bin_path)),
        "        <string>agent</string>".to_string(),
        "        <string>run</string>".to_string(),
        "        <string>start</string>".to_string(),
        "        <string>--agent</string>".to_string(),
        format!("        <string>{}</string>", xml_escape(agent_id)),
        "        <string>--detach</string>".to_string(),
        "    </array>".to_string(),
        "    <key>StartCalendarInterval</key>".to_string(),
        "    <array>".to_string(),
    ];
    for dict in &dicts {
        lines.push("        <dict>".to_string());
        for &(key, value) in dict {
            lines.push(format!("            <key>{key}</key>"));
            lines.push(format!("            <integer>{value}</integer>"));
        }
        lines.push("        </dict>".to_string());
    }
    let log_path = xml_escape(&format!("/var/log/sc-agent-{agent_id}.log"));
    lines.extend([
        "    </array>".to_string(),
        "    <key>StandardOutPath</key>".to_string(),
        format!("    <string>{log_path}</string>"),
        "    <key>StandardErrorPath</key>".to_string(),
        format!("    <string>{log_path}</string>"),
        "    <key>RunAtLoad</key>".to_string(),
        "    <false/>".to_string(),
        "</dict>".to_string(),
        "</plist>".to_string(),
    ]);
    Ok(lines.join("\n") + "\n")
}

const DOW_ELEMENT_NAMES: [&str; 7] =
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_ELEMENT_NAMES: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
];
const ALL_MONTHS: [u32; 12] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/// A Windows `CalendarTrigger` fires at one time of day per trigger, so
/// unlike the comma lists cron/systemd accept or launchd's per-value
/// dicts, this exporter only supports a schedule whose minute and hour
/// fields each resolve to exactly one value — the shape every trading-
/// agent schedule in practice actually needs ("once a day, at market
/// open"). A schedule needing several times a day would need several
/// triggers or a `<Repetition>` interval, neither of which this function
/// generates; it refuses rather than silently keeping only one of the
/// times.
fn render_task_scheduler(agent_id: &str, fields: &CronFields, bin_path: &str) -> Result<String> {
    ensure_single_calendar_family(fields, "task-scheduler")?;
    if fields.minutes.len() != 1 || fields.hours.len() != 1 {
        bail!(
            "Agent input invalid: Windows Task Scheduler XML needs a single minute and hour value (got {} minute value(s) and {} hour value(s)); this exporter does not generate one trigger per time of day — use the cron or systemd-timer format instead",
            fields.minutes.len(),
            fields.hours.len()
        );
    }
    let minute = fields.minutes[0];
    let hour = fields.hours[0];

    // ScheduleByWeek/ScheduleByMonth/ScheduleByDay each own the "which
    // days" question; `ensure_single_calendar_family` guarantees at most
    // one of day-of-month/day-of-week is restricted, so there is never a
    // conflict between the branches below over which one applies.
    let schedule_lines: Vec<String> = if !fields.dow_is_star {
        let mut v = vec!["      <ScheduleByWeek>".to_string(), "        <DaysOfWeek>".to_string()];
        v.extend(fields.dows.iter().map(|&d| format!("          <{}/>", DOW_ELEMENT_NAMES[d as usize])));
        v.push("        </DaysOfWeek>".to_string());
        v.push("        <WeeksInterval>1</WeeksInterval>".to_string());
        v.push("      </ScheduleByWeek>".to_string());
        v
    } else if !fields.dom_is_star {
        let month_values: &[u32] = if fields.month_is_star { &ALL_MONTHS } else { &fields.months };
        let mut v = vec!["      <ScheduleByMonth>".to_string(), "        <DaysOfMonth>".to_string()];
        v.extend(fields.doms.iter().map(|&d| format!("          <Day>{d}</Day>")));
        v.push("        </DaysOfMonth>".to_string());
        v.push("        <Months>".to_string());
        v.extend(month_values.iter().map(|&m| format!("          <{}/>", MONTH_ELEMENT_NAMES[(m - 1) as usize])));
        v.push("        </Months>".to_string());
        v.push("      </ScheduleByMonth>".to_string());
        v
    } else if fields.month_is_star {
        vec![
            "      <ScheduleByDay>".to_string(),
            "        <DaysInterval>1</DaysInterval>".to_string(),
            "      </ScheduleByDay>".to_string(),
        ]
    } else {
        bail!(
            "Agent input invalid: a month-restricted schedule with no day-of-month or day-of-week restriction has no direct Windows Task Scheduler equivalent this exporter generates — restrict a day field too, or use the cron/systemd-timer format instead"
        );
    };

    let arguments = format!("agent run start --agent {} --detach", win_quote(agent_id));

    let mut lines: Vec<String> = vec![
        "<?xml version=\"1.0\" encoding=\"UTF-16\"?>".to_string(),
        "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">".to_string(),
        "  <RegistrationInfo>".to_string(),
        format!("    <Description>{}</Description>", xml_escape(&format!("Scheduled run of sc agent '{agent_id}'"))),
        "  </RegistrationInfo>".to_string(),
        "  <Triggers>".to_string(),
        "    <CalendarTrigger>".to_string(),
        // The date component is only an anchor for the recurrence pattern
        // below it — ScheduleByWeek/ByMonth/ByDay, not StartBoundary's own
        // date, decides which days the trigger actually fires on.
        format!("      <StartBoundary>2024-01-01T{hour:02}:{minute:02}:00</StartBoundary>"),
        "      <Enabled>true</Enabled>".to_string(),
    ];
    lines.extend(schedule_lines);
    lines.extend([
        "    </CalendarTrigger>".to_string(),
        "  </Triggers>".to_string(),
        "  <Principals>".to_string(),
        "    <Principal id=\"Author\">".to_string(),
        "      <LogonType>InteractiveToken</LogonType>".to_string(),
        "    </Principal>".to_string(),
        "  </Principals>".to_string(),
        "  <Settings>".to_string(),
        "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>".to_string(),
        "    <StartWhenAvailable>true</StartWhenAvailable>".to_string(),
        "  </Settings>".to_string(),
        "  <Actions Context=\"Author\">".to_string(),
        "    <Exec>".to_string(),
        format!("      <Command>{}</Command>", xml_escape(bin_path)),
        format!("      <Arguments>{}</Arguments>", xml_escape(&arguments)),
        "    </Exec>".to_string(),
        "  </Actions>".to_string(),
        "</Task>".to_string(),
    ]);
    Ok(lines.join("\n") + "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cron_snippet_quotes_the_id_and_binary_and_escapes_percent() {
        let snippet =
            render_cron("o'brien%agent", "0 7 * * 1-5", "/opt/weird path/sc");
        assert_eq!(
            snippet,
            r"0 7 * * 1-5 '/opt/weird path/sc' agent run start --agent 'o'\''brien\%agent' --detach >> /var/log/sc-agent.log 2>&1"
        );
    }

    #[test]
    fn cron_export_matches_the_spec_example_shape() {
        let artifact = export("momentum-eu-etfs", "0 7 * * 1-5", ScheduleFormat::Cron).expect("export");
        assert_eq!(artifact.agent_id, "momentum-eu-etfs");
        assert_eq!(artifact.format, ScheduleFormat::Cron);
        assert!(artifact.snippet.starts_with("0 7 * * 1-5 "));
        assert!(artifact.snippet.contains("agent run start --agent 'momentum-eu-etfs' --detach"));
        assert!(artifact.snippet.ends_with(">> /var/log/sc-agent.log 2>&1"));
        assert!(artifact.note.contains("crontab -e"));
    }

    #[test]
    fn systemd_timer_quotes_exec_start_and_builds_on_calendar() {
        let fields = parse_cron("0 7 * * 1-5").expect("parse");
        let snippet =
            render_systemd_timer("mo\"m$agent", &fields, "/opt/weird\"$path\\sc").expect("render");
        assert!(snippet.contains(
            "ExecStart=\"/opt/weird\\\"$$path\\\\sc\" agent run start --agent \"mo\\\"m$$agent\" --detach"
        ));
        assert!(snippet.contains("OnCalendar=Mon,Tue,Wed,Thu,Fri *-*-* 07:00:00"));
        assert!(snippet.contains("[Timer]"));
        assert!(snippet.contains("[Service]"));
        assert!(snippet.contains("Persistent=true"));
        assert!(snippet.contains("WantedBy=timers.target"));
    }

    #[test]
    fn systemd_timer_rejects_both_dom_and_dow_restricted() {
        let fields = parse_cron("0 7 1,15 * 1-5").expect("parse");
        let err = render_systemd_timer("agent-a", &fields, "/usr/local/bin/sc")
            .expect_err("both dom and dow restricted must be refused");
        assert!(err.to_string().contains("day-of-month and day-of-week"));
    }

    #[test]
    fn launchd_plist_escapes_xml_and_expands_weekdays() {
        let fields = parse_cron("0 7 * * 1-5").expect("parse");
        let snippet = render_launchd("agent&<x>'\"", &fields, "/opt/sc").expect("render");
        assert!(snippet.contains("<string>agent&amp;&lt;x&gt;&apos;&quot;</string>"));
        assert_eq!(snippet.matches("<key>Weekday</key>").count(), 5);
        assert!(snippet.contains("<key>Minute</key>\n            <integer>0</integer>"));
        assert!(snippet.contains("<key>Hour</key>\n            <integer>7</integer>"));
        assert!(!snippet.contains("<key>Day</key>"));
        assert!(!snippet.contains("<key>Month</key>"));
    }

    #[test]
    fn launchd_caps_a_pathological_combinatorial_expansion() {
        let fields = parse_cron("*/2 * 1-31 * *").expect("parse");
        let err = render_launchd("agent-a", &fields, "/usr/local/bin/sc")
            .expect_err("30 minute values x 31 dom values must exceed the cap");
        assert!(err.to_string().contains("safety cap"));
    }

    #[test]
    fn task_scheduler_xml_escapes_and_quotes_arguments() {
        let fields = parse_cron("0 7 * * 1-5").expect("parse");
        let snippet =
            render_task_scheduler("agent \"the best\" one", &fields, "C:\\Program Files\\sc & co\\sc.exe")
                .expect("render");
        assert!(snippet.contains(
            "<Arguments>agent run start --agent &quot;agent \\&quot;the best\\&quot; one&quot; --detach</Arguments>"
        ));
        assert!(snippet.contains("<Command>C:\\Program Files\\sc &amp; co\\sc.exe</Command>"));
        assert!(snippet.contains("<Monday/>"));
        assert!(snippet.contains("<Friday/>"));
        assert!(!snippet.contains("<Saturday/>"));
        assert!(snippet.contains("<StartBoundary>2024-01-01T07:00:00</StartBoundary>"));
    }

    #[test]
    fn task_scheduler_rejects_more_than_one_time_of_day() {
        let fields = parse_cron("0,30 7 * * 1-5").expect("parse");
        let err = render_task_scheduler("agent-a", &fields, "/usr/local/bin/sc")
            .expect_err("two minute values must be refused");
        assert!(err.to_string().contains("single minute and hour value"));
    }

    #[test]
    fn parse_field_expands_steps_and_ranges() {
        assert_eq!(parse_field("*/15", 0, 59, "minute").unwrap(), vec![0, 15, 30, 45]);
        assert_eq!(parse_field("1-3,8", 0, 23, "hour").unwrap(), vec![1, 2, 3, 8]);
        assert_eq!(parse_field("*", 1, 12, "month").unwrap(), (1..=12).collect::<Vec<_>>());
    }

    #[test]
    fn parse_field_rejects_out_of_range_and_malformed_values() {
        assert!(parse_field("60", 0, 59, "minute").is_err());
        assert!(parse_field("5-1", 0, 59, "minute").is_err());
        assert!(parse_field("abc", 0, 59, "minute").is_err());
        assert!(parse_field("*/0", 0, 59, "minute").is_err());
    }

    #[test]
    fn parse_dow_field_folds_seven_into_zero() {
        assert_eq!(parse_dow_field("0,7").unwrap(), vec![0]);
    }

    #[test]
    fn parse_cron_rejects_the_wrong_field_count() {
        assert!(parse_cron("0 7 * * * *").is_err());
        assert!(parse_cron("0 7 *").is_err());
    }

    #[test]
    fn export_rejects_an_empty_schedule() {
        let err = export("agent-a", "   ", ScheduleFormat::Cron).expect_err("empty schedule must be refused");
        assert!(err.to_string().contains("no schedule configured"));
    }

    #[test]
    fn export_rejects_a_newline_in_the_agent_id() {
        let err = export("agent-a\nrm -rf /", "0 7 * * 1-5", ScheduleFormat::Cron)
            .expect_err("a newline in the agent id must be refused");
        assert!(err.to_string().contains("newline"));
    }
}
