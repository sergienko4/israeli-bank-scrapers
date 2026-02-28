/**
 * Introspect the OneZero GraphQL API to discover available fields on key types.
 * Uses the saved ONEZERO_OTP_LONG_TERM_TOKEN (no SMS needed if token is fresh).
 *
 * Usage:
 *   npx ts-node scripts/inspect-onezero-schema.ts
 *
 * Reports all fields on Portfolio, Account, and Movement types
 * so we can find the real balance field name.
 */
import * as dotenv from 'dotenv';
import { fetchPost, fetchGraphql } from '../src/helpers/fetch';

dotenv.config();

const GRAPHQL_API_URL = 'https://mobile.tfd-bank.com/mobile-graph/graphql';
const IDENTITY_URL = 'https://identity.tfd-bank.com/v1/';

const INTROSPECT_TYPE = (typeName: string) => `
{
  __type(name: "${typeName}") {
    name
    fields {
      name
      type {
        name
        kind
        ofType { name kind ofType { name kind } }
      }
    }
  }
}`;

async function getAccessToken(): Promise<string> {
  const email = process.env.ONEZERO_EMAIL;
  const password = process.env.ONEZERO_PASSWORD;
  const otpLongTermToken = process.env.ONEZERO_OTP_LONG_TERM_TOKEN;

  if (!email || !password) {
    throw new Error('Missing ONEZERO_EMAIL or ONEZERO_PASSWORD in .env');
  }
  if (!otpLongTermToken) {
    throw new Error('Missing ONEZERO_OTP_LONG_TERM_TOKEN in .env — run run-onezero.ts first to get a token');
  }

  console.log('Getting access token with saved OTP token...');
  const idTokenRes = await fetchPost(`${IDENTITY_URL}/getIdToken`, {
    otpSmsToken: otpLongTermToken,
    email,
    pass: password,
    pinCode: '',
  });
  const { idToken } = idTokenRes.resultData;

  const sessionRes = await fetchPost(`${IDENTITY_URL}/sessions/token`, {
    idToken,
    pass: password,
  });
  return sessionRes.resultData.accessToken;
}

async function introspectType(typeName: string, token: string): Promise<void> {
  console.log(`\n=== ${typeName} fields ===`);
  try {
    const result = await fetchGraphql<{ __type: { name: string; fields: Array<{ name: string; type: { name: string | null; kind: string; ofType: { name: string | null } | null } }> } | null }>(
      GRAPHQL_API_URL,
      INTROSPECT_TYPE(typeName),
      {},
      { authorization: `Bearer ${token}` },
    );

    if (!result.__type) {
      console.log(`  (type "${typeName}" not found in schema)`);
      return;
    }

    const fields = result.__type.fields ?? [];
    const balanceFields = fields.filter(f =>
      f.name.toLowerCase().includes('balance') ||
      f.name.toLowerCase().includes('amount') ||
      f.name.toLowerCase().includes('available')
    );

    console.log(`  Total fields: ${fields.length}`);
    if (balanceFields.length) {
      console.log(`  Balance-related fields:`);
      for (const f of balanceFields) {
        const typeName = f.type.name ?? f.type.ofType?.name ?? `${f.type.kind}`;
        console.log(`    ${f.name}: ${typeName}`);
      }
    } else {
      console.log(`  No balance-related fields found`);
      console.log(`  All fields: ${fields.map(f => f.name).join(', ')}`);
    }
  } catch (e: unknown) {
    console.log(`  Error: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
  }
}

async function main(): Promise<void> {
  const token = await getAccessToken();
  console.log('Got access token ✓');

  // Introspect the types we care about
  await introspectType('Portfolio', token);
  await introspectType('Account', token);
  await introspectType('Movement', token);
  await introspectType('Movements', token);
  await introspectType('PortfolioBalance', token);
  await introspectType('AccountBalance', token);
  await introspectType('Balance', token);

  // Find which Query fields return AccountBalance
  console.log('\n=== Query fields returning AccountBalance ===');
  const queryType = await fetchGraphql<{ __type: { fields: Array<{ name: string; type: { name: string | null; kind: string; ofType: { name: string | null } | null }; args: Array<{ name: string }> }> } }>(
    GRAPHQL_API_URL,
    '{ __type(name: "Query") { fields { name args { name } type { name kind ofType { name } } } } }',
    {},
    { authorization: `Bearer ${token}` },
  );
  const accountBalanceQueries = queryType.__type.fields.filter(f => {
    const typeName = f.type.name ?? f.type.ofType?.name ?? '';
    return typeName.toLowerCase().includes('balance') || typeName.toLowerCase().includes('account');
  });
  accountBalanceQueries.forEach(f => {
    console.log(`  ${f.name}(${f.args.map(a => a.name).join(', ')}) -> ${f.type.name ?? f.type.ofType?.name}`);
  });
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
