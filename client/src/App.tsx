import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { WifiSlash } from '@phosphor-icons/react';
import { ConsoleProvider, useConsole } from './state';
import { Sidebar, Toasts, Topbar } from './components/Shell';
import OrderDrawer from './components/OrderDrawer';
import Overview from './views/Overview';
import NewOrder from './views/NewOrder';
import Orders from './views/Orders';
import { enter } from './motion';

function Content() {
  const { view, online, refresh } = useConsole();
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <Sidebar />
      <div className="main-col">
        <Topbar />
        {!online && (
          <div className="banner" role="alert">
            <WifiSlash size={18} aria-hidden /> Can’t reach the server. Changes won’t be saved.
            <button type="button" className="btn btn-secondary sm" onClick={() => refresh()}>Retry</button>
          </div>
        )}
        <main id="main" tabIndex={-1}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} {...enter}>
              {view === 'overview' && <Overview />}
              {view === 'new' && <NewOrder />}
              {view === 'orders' && <Orders />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <OrderDrawer />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ConsoleProvider>
        <Content />
      </ConsoleProvider>
    </MotionConfig>
  );
}
