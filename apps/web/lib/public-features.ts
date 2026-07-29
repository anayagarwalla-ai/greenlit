/**
 * Keep account-backed agency workflows implemented while they are not yet
 * advertised on the public product surface. Set this public build flag to
 * "true" when invitations and sign-in are ready to be offered again.
 */
export const AGENCY_BETA_SIGN_IN_VISIBLE =
  process.env.NEXT_PUBLIC_AGENCY_BETA_SIGN_IN_ENABLED === "true";
