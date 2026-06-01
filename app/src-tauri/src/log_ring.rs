use std::collections::VecDeque;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use tracing::{
	field::{Field, Visit},
	span::{Attributes, Id, Record},
	Event, Level, Metadata, Subscriber,
};

const MAX_LINES: usize = 600;

static RING: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

fn ring() -> &'static Mutex<VecDeque<String>> {
	RING.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_LINES)))
}

pub fn push_line(line: String) {
	let mut guard = ring()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner());
	if guard.len() >= MAX_LINES {
		guard.pop_front();
	}
	guard.push_back(line);
}

pub fn recent_lines() -> Vec<String> {
	ring()
		.lock()
		.unwrap_or_else(|poisoned| poisoned.into_inner())
		.iter()
		.cloned()
		.collect()
}

#[derive(Default)]
struct MessageVisitor {
	buf: String,
}

impl Visit for MessageVisitor {
	fn record_u64(&mut self, field: &Field, value: u64) {
		let _ = write!(self.buf, " {}={value}", field.name());
	}

	fn record_bool(&mut self, field: &Field, value: bool) {
		let _ = write!(self.buf, " {}={value}", field.name());
	}

	fn record_i64(&mut self, field: &Field, value: i64) {
		let _ = write!(self.buf, " {}={value}", field.name());
	}

	fn record_str(&mut self, field: &Field, value: &str) {
		if field.name() == "message" {
			self.buf.push_str(value);
		} else {
			let _ = write!(self.buf, " {}={value}", field.name());
		}
	}

	fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
		if field.name() == "message" {
			let _ = write!(self.buf, "{value:?}");
		} else {
			let _ = write!(self.buf, " {}={value:?}", field.name());
		}
	}
}

/// Forwards tracing events into the `log` crate so groove diagnostics land in
/// the in-app ring buffer and `os_log`.
pub struct LogForwardSubscriber;

static SPAN_ID: AtomicU64 = AtomicU64::new(1);

impl Subscriber for LogForwardSubscriber {
	fn enabled(&self, metadata: &Metadata<'_>) -> bool {
		let target = metadata.target();
		let level = *metadata.level();

		// `groove::query_manager` emits a debug line per subscription creation/delta — keep warn+.
		if target.starts_with("groove::query_manager") && level > Level::WARN {
			return false;
		}

		true
	}

	fn new_span(&self, _: &Attributes<'_>) -> Id {
		Id::from_u64(SPAN_ID.fetch_add(1, Ordering::Relaxed))
	}

	fn record(&self, _: &Id, _: &Record<'_>) {}
	fn record_follows_from(&self, _: &Id, _: &Id) {}

	fn event(&self, event: &Event<'_>) {
		let meta = event.metadata();
		let level = match *meta.level() {
			Level::TRACE => log::Level::Trace,
			Level::DEBUG => log::Level::Debug,
			Level::INFO => log::Level::Info,
			Level::WARN => log::Level::Warn,
			Level::ERROR => log::Level::Error,
		};
		let target = meta.target();
		let mut visitor = MessageVisitor::default();
		event.record(&mut visitor);
		let message = visitor.buf;

		log::logger().log(
			&log::Record::builder()
				.level(level)
				.target(target)
				.args(format_args!("{message}"))
				.build(),
		);
	}

	fn enter(&self, _: &Id) {}
	fn exit(&self, _: &Id) {}
}

/// Install the tracing → log bridge. Safe to call multiple times; only the first
/// call wins (`set_global_default` is one-shot).
pub fn init_tracing_bridge() {
	let _ = tracing::subscriber::set_global_default(LogForwardSubscriber);
}
