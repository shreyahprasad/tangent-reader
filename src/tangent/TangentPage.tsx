import { ArticleView } from "./ArticleView";
import { Library } from "./Library";
import { parse } from "./route";

// #/ is the library; under it each session's article, at a sentence or with a thread open
// (route.ts has the addresses).

export function TangentPage({ path }: { path: string[] }) {
  const view = parse(path);
  if (view.kind === "library") return <Library />;
  return <ArticleView key={view.session} view={view} />;
}
