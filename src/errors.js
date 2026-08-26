export class MaestroError extends Error {
  constructor(message, code = "MAESTRO_ERROR") {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ValidationError extends MaestroError {
  constructor(message) {
    super(message, "VALIDATION_ERROR");
  }
}

export class NotInitializedError extends MaestroError {
  constructor(root) {
    super(`Maestro is not initialized at ${root}`, "NOT_INITIALIZED");
  }
}

export class ConfirmationRequiredError extends MaestroError {
  constructor() {
    super("Creating a formal Task requires explicit user confirmation.", "CONFIRMATION_REQUIRED");
  }
}

export class NotFoundError extends MaestroError {
  constructor(kind, id) {
    super(`${kind} not found: ${id}`, "NOT_FOUND");
  }
}
