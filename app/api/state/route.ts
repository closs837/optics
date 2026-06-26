import { handle, json, userId } from '@/lib/api';
import { state, history } from '@/db/store';
export async function GET(req: Request) {
  return handle(async () => {
    const owner = await userId();
    const id = new URL(req.url).searchParams.get('watchId');
    return json(
      id ? { history: await history(owner, id) } : await state(owner),
    );
  });
}
