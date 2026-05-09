import { ulid } from 'ulid';

export function newId() {
  return ulid();
}
