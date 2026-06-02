export type LlmArtifactTransport =
  | "openai.responses.input_image.data_url"
  | "openai.responses.input_file.data_url"
  | "openai.chat.image_url.data_url"
  | "openai.chat.input_audio.base64";