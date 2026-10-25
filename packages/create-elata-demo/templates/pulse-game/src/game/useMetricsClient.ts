import { useEffect, useState } from 'react';
import {
  createMetricsClient,
  type AppRecord,
  type AppScore,
  type MetricsClient,
} from '@elata-biosciences/app-metrics';

export type MetricsState =
  | { status: 'connecting' }
  | { status: 'ready'; client: MetricsClient }
  | { status: 'error'; message: string };

// Created when this module is first imported, so its message listener is attached before the iframe's load
// event. The host posts its one init message on that load event; a client created later in a React effect
// can miss it, which left the game on "metrics host did not respond" on a cold dev server. One client per
// page also survives StrictMode's mount, unmount, mount.
const client = createMetricsClient();

export function useMetricsClient(): MetricsState {
  const [state, setState] = useState<MetricsState>({ status: 'connecting' });

  useEffect(() => {
    let active = true;
    client
      .ready()
      .then(() => active && setState({ status: 'ready', client }))
      .catch((err: Error) =>
        active &&
        setState({
          status: 'error',
          message: err.message || 'Metrics host handshake failed.',
        }),
      );
    return () => {
      active = false;
    };
  }, []);

  return state;
}

export type { AppRecord, AppScore, MetricsClient };
