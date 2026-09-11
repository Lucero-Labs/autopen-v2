export type {
  Severity,
  RuleContext,
  RuleContextOverrides,
  RuleOutcome,
  Rule,
  Policy,
  PolicyKey,
  PolicyRegistry,
  Finding,
  GateVerdict,
  Gate,
} from "./contracts.js";

export type {
  DocumentId,
  CeremonyId,
  ContentHash,
  Clock,
  SealedDocument,
  SignerIdentity,
  SignerRole,
  CeremonyHandoff,
  Ceremony,
  CeremonyDisposition,
  CeremonyState,
  CeremonyStatus,
  SignatureAttestation,
  VerifiedArtifact,
  SignedDelivery,
  CustodySink,
  SignatureProvider,
  DocumentStore,
  CeremonyLedger,
  SigningCore,
} from "./signing.js";

export { sha256, deriveDocumentId, seal } from "./seal.js";

export { DefaultSigningCore, type SigningCoreOptions } from "./signing-core.js";

export { InMemoryDocumentStore, InMemoryCeremonyLedger } from "./stores.js";

export {
  CoreError,
  PolicyNotFoundError,
  DuplicatePolicyError,
  DuplicateRuleIdError,
  RuleEvaluationError,
  SealConflictError,
  HashUnavailableError,
  CeremonyNotFoundError,
  DocumentNotSealedError,
  CustodyFailedError,
} from "./errors.js";
