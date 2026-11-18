export const PAYMENT_PROTO_SOURCE = `
syntax = "proto3";

package disopay.payment.v1;

message CreateCheckoutSessionRequest {
  string transaction_id = 1;
  string method = 2;
  string currency = 3;
}

message CheckoutSessionResponse {
  string transaction_id = 1;
  string provider = 2;
  string method = 3;
  string currency = 4;
  int64 amount = 5;
  string provider_session_id = 6;
  string url = 7;
  int64 expires_at = 8;
  bool reused = 9;
}

message GetCheckoutOptionsRequest {}

message MethodOption {
  string id = 1;
  string label = 2;
  string provider = 3;
  bool php_only = 4;
  string description = 5;
}

message CheckoutOptions {
  repeated MethodOption methods = 1;
  repeated string currencies = 2;
  string fx_php_per_usd = 3;
  int64 transaction_ttl_seconds = 4;
}

service PaymentService {
  rpc CreateCheckoutSession(CreateCheckoutSessionRequest) returns (CheckoutSessionResponse);
  rpc GetCheckoutOptions(GetCheckoutOptionsRequest) returns (CheckoutOptions);
}
`;
