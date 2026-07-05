const body = '{"associatedApplications":[{"applicationId":"a91388a3-de7a-4685-9070-1bdac5e1c9c6"}]}';

export function GET(): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
