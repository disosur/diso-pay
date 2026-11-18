export const LEDGER_PROTO_SOURCE = `
syntax = "proto3";

package disopay.ledger.v1;

message LineItem {
  string name = 1;
  int64 amount = 2;
  int64 quantity = 3;
  string image = 4;
}

message PaymentSession {
  string provider = 1;
  string method = 2;
  string currency = 3;
  int64 amount = 4;
  string provider_session_id = 5;
  string url = 6;
  int64 expires_at = 7;
  int64 created_at = 8;
}

message Transaction {
  string id = 1;
  string status = 2;
  string currency = 3;
  int64 amount_total = 4;
  repeated LineItem line_items = 5;
  string success_url = 6;
  string cancel_url = 7;
  string reference = 8;
  string description = 9;
  string customer_email = 10;
  map<string, string> metadata = 11;
  repeated PaymentSession sessions = 12;
  int64 created_at = 13;
  int64 expires_at = 14;
  int64 updated_at = 15;
  string last_outcome = 16;
  string payment_method = 17;
}

message LedgerEvent {
  int64 id = 1;
  string transaction_id = 2;
  int64 sequence = 3;
  string type = 4;
  string payload_json = 5;
  string idempotency_key = 6;
  int64 created_at = 7;
}

message AppendEventRequest {
  string transaction_id = 1;
  string type = 2;
  string payload_json = 3;
  string idempotency_key = 4;
}

message AppendEventResponse {
  LedgerEvent event = 1;
  bool duplicate = 2;
}

message GetTransactionRequest {
  string transaction_id = 1;
}

message GetTransactionResponse {
  Transaction transaction = 1;
}

message FindActiveTransactionRequest {
  string reference = 1;
}

message FindActiveTransactionResponse {
  Transaction transaction = 1;
}

message ListEventsRequest {
  string transaction_id = 1;
}

message ListEventsResponse {
  repeated LedgerEvent events = 1;
}

service LedgerService {
  rpc AppendEvent(AppendEventRequest) returns (AppendEventResponse);
  rpc GetTransaction(GetTransactionRequest) returns (GetTransactionResponse);
  rpc FindActiveTransaction(FindActiveTransactionRequest) returns (FindActiveTransactionResponse);
  rpc ListEvents(ListEventsRequest) returns (ListEventsResponse);
}
`;
