export async function streamToString(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  let result = "";
  if (!stream) {
    return result;
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }

  return result;
}
