import Monitor from './monitor';
import { getChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <Monitor
      signedIn={!!user}
      displayName={user?.fullName ?? (user ? 'My account' : null)}
    />
  );
}
