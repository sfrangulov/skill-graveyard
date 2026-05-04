// Writes report sections sequentially with an optional inter-section delay so
// long terminal outputs feel "alive" instead of dumping everything at once.
// When animate=false (pipe/CI/--no-animate/NO_ANIMATE=1) the output is written
// in a single burst, byte-identical to `sections.join(separator) + "\n"`.

export interface StreamSectionsOptions {
  stream?: NodeJS.WriteStream;
  animate: boolean;
  delayMs?: number;
  separator?: string;
}

export async function streamSections(
  sections: readonly string[],
  opts: StreamSectionsOptions,
): Promise<void> {
  const stream = opts.stream ?? process.stdout;
  const separator = opts.separator ?? "\n\n";
  const delayMs = opts.delayMs ?? 120;
  if (sections.length === 0) return;

  if (!opts.animate) {
    stream.write(sections.join(separator) + "\n");
    return;
  }

  for (let i = 0; i < sections.length; i++) {
    stream.write(sections[i]!);
    if (i < sections.length - 1) {
      stream.write(separator);
      await sleep(delayMs);
    }
  }
  stream.write("\n");
}

// True only when the user is running interactively AND hasn't opted out via
// `--no-animate` or `NO_ANIMATE=1` (we follow the same convention as NO_COLOR).
export function shouldAnimate(
  stream: NodeJS.WriteStream,
  noAnimateFlag: boolean,
): boolean {
  if (noAnimateFlag) return false;
  if ((process.env.NO_ANIMATE ?? "") !== "") return false;
  return stream.isTTY === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
