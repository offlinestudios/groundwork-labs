export default function handler(request, response) {
  response.status(200).json({
    ok: true,
    service: 'Ground Work Labs lead intake',
    configured: Boolean(process.env.DATABASE_URL && process.env.RESEND_API_KEY)
  });
}
