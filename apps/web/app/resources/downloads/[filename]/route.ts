import { renderResourceDownload } from "@/lib/resource-download";
import { publicResourceGuides } from "@/lib/resource-library";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const guide = publicResourceGuides.find((candidate) => candidate.downloadHref?.endsWith(`/${filename}`));

  if (!guide) {
    return new Response("Resource not found.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const plainText = filename.endsWith(".txt");

  return new Response(renderResourceDownload(guide), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": `${plainText ? "text/plain" : "text/markdown"}; charset=utf-8`,
    },
  });
}
