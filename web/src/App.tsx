import { Navigate, Route, Routes } from 'react-router-dom';
import { NameForm } from './components/NameForm';
import { Card, Page, Spinner } from './components/ui';
import { useMe } from './hooks';
import { GamePage } from './pages/Game';
import { GroupPage } from './pages/Group';
import { Home } from './pages/Home';
import { JoinPage } from './pages/Join';
import { NewGame } from './pages/NewGame';
import { NewSession } from './pages/NewSession';
import { Profile } from './pages/Profile';
import { SessionPage } from './pages/Session';

export function App() {
  const me = useMe();
  if (me.isLoading) return <Spinner />;

  return (
    <Routes>
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="*" element={me.data ? <SignedIn /> : <Welcome />} />
    </Routes>
  );
}

function SignedIn() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/me" element={<Profile />} />
      <Route path="/g/:id" element={<GroupPage />} />
      <Route path="/new-session" element={<NewSession />} />
      <Route path="/s/:id" element={<SessionPage />} />
      <Route path="/s/:id/new-game" element={<NewGame />} />
      <Route path="/game/:id" element={<GamePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Welcome() {
  return (
    <Page>
      <div className="flex flex-col items-center gap-2 pb-2 pt-8 text-center">
        <div className="text-6xl">🂡</div>
        <h1 className="font-display text-4xl font-bold text-gold-300">Declare</h1>
        <p className="max-w-xs text-white/70">Shuffle, deal and keep score for card nights — at the table or online.</p>
      </div>
      <Card title="What should we call you?">
        <NameForm cta="Let's play" />
      </Card>
      <p className="text-center text-sm text-white/50">
        Got a join code? Open the link you were sent, or enter it after you pick a name.
      </p>
    </Page>
  );
}
