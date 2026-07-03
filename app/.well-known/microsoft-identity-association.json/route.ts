const body = '{"associatedApplications":[{"applicationId":"58b58f77-37b0-44e4-86d6-41bff30199b7"}]}';

export function GET(): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
