import m from 'mithril';
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/functions';
import 'firebase/firestore';

export type Auth = firebase.auth.Auth;
export type Firestore = firebase.firestore.Firestore;
export type DocumentReference = firebase.firestore.DocumentReference;
export type Functions = firebase.functions.Functions;
export const FieldValue = firebase.firestore.FieldValue;

type Services = {
  auth: Auth;
  firestore: Firestore;
  functions: Functions;
};

let _firebaseReady: Promise<Services> | null = null;

export function getServices(): Promise<Services> {
  if (_firebaseReady === null) {
    _firebaseReady = initFirebase();
  }
  return _firebaseReady;
}

type HostAndPort = { host: string; port: number };
declare const EMULATOR_OPTIONS: null | {
  auth: HostAndPort;
  firestore: HostAndPort;
  functions: HostAndPort;
};

async function initFirebase(): Promise<Services> {
  const config = await m.request<Object>('/__/firebase/init.json');
  const app = firebase.initializeApp({
    // Default config in case Firebase is not initialized:
    projectId: 'demo-senko',
    apiKey: 'fake-api-key',

    // Overwrite with real config (if available).
    ...config,
  });
  const auth = app.auth();
  const firestore = app.firestore();
  const functions = app.functions();

  let emulatorOptions = EMULATOR_OPTIONS;
  if (emulatorOptions) {
    if (emulatorOptions.auth) {
      auth.useEmulator(`http://${emulatorOptions.auth.host}:${emulatorOptions.auth.port}`);
    }
    if (emulatorOptions.functions) {
      functions.useFunctionsEmulator(
        `http://${emulatorOptions.functions.host}:${emulatorOptions.functions.port}`,
      );
    }
    if (emulatorOptions.firestore) {
      firestore.settings({
        host: `${emulatorOptions.firestore.host}:${emulatorOptions.firestore.port}`,
        ssl: false,
      });
    }
  }

  return { auth, firestore, functions };
}
