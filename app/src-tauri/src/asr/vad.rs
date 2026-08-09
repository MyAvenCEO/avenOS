//! Silero VAD v5, driven directly through ONNX Runtime.
//!
//! There are two ready-made Rust crates for this, and neither can be used here:
//! both pin `ort` 2.0.0-rc.10 while `parakeet-rs` requires rc.13, and the API
//! changed between them. Rather than pin the recognizer backwards, the model is
//! small and its interface is four tensors, so it is driven directly — which
//! also means one `ort` version across the whole app.
//!
//! The graph is stateful: each call takes the previous 2x1x128 hidden state and
//! returns the next one, so windows must be fed in order and a reset means
//! zeroing that state.

use anyhow::{Context, Result};
use ndarray::{Array1, Array2, Array3};
use ort::{session::Session, value::Value};

/// Silero accepts exactly one window size per rate: 512 samples at 16 kHz (32 ms).
pub const WINDOW: usize = 512;
const SAMPLE_RATE: i64 = 16_000;
const STATE_DIM: usize = 128;

pub const MODEL_URL: &str =
	"https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx";

pub struct Vad {
	session: Session,
	/// `[2, batch, 128]` — carried between windows.
	state: Array3<f32>,
}

impl Vad {
	pub fn open(model_path: &std::path::Path) -> Result<Self> {
		let session = Session::builder()?
			.commit_from_file(model_path)
			.context("failed to open the Silero VAD model")?;
		Ok(Self {
			session,
			state: Array3::zeros((2, 1, STATE_DIM)),
		})
	}

	/// Probability that `window` (exactly [`WINDOW`] samples) contains speech.
	pub fn predict(&mut self, window: &[f32]) -> Result<f32> {
		debug_assert_eq!(window.len(), WINDOW);

		let audio = Array2::from_shape_vec((1, window.len()), window.to_vec())?;
		let rate = Array1::from_vec(vec![SAMPLE_RATE]);

		let outputs = self.session.run(ort::inputs! {
			"input" => &Value::from_array(audio)?,
			"state" => &Value::from_array(self.state.clone())?,
			"sr" => &Value::from_array(rate)?
		})?;

		// Carry the hidden state forward before reading the probability, so an
		// early return can never leave the state stale.
		let (shape, next) = outputs["stateN"].try_extract_tensor::<f32>()?;
		if shape.len() == 3 {
			self.state = Array3::from_shape_vec(
				(shape[0] as usize, shape[1] as usize, shape[2] as usize),
				next.to_vec(),
			)?;
		}

		let (_, probability) = outputs["output"].try_extract_tensor::<f32>()?;
		Ok(probability.first().copied().unwrap_or(0.0))
	}

	/// Forget everything heard so far.
	pub fn reset(&mut self) {
		self.state = Array3::zeros((2, 1, STATE_DIM));
	}
}
