# CRMEB 会员支付成功 → shunwei-api 回调

在 `crmeb/app/services/order/OtherOrderServices.php` 的 `paySuccess()` 方法中，
`setMemberOverdueTime()` 成功后追加：

```php
// 顺为定制：通知 shunwei-api 发放开卡赠送积分
try {
    $callbackUrl = rtrim((string)env('SHUNWEI_API_URL', 'http://127.0.0.1:8787'), '/')
        . '/api/internal/membership/pay-callback';
    $shipId = 0;
    if (!empty($orderInfo['member_type'])) {
        /** @var \app\services\user\member\MemberShipServices $shipService */
        $shipService = app()->make(\app\services\user\member\MemberShipServices::class);
        $shipList = $shipService->getApiList(['is_del' => 0]);
        foreach ($shipList as $ship) {
            if (($ship['type'] ?? '') === ($orderInfo['member_type'] ?? '')) {
                $shipId = (int)($ship['id'] ?? 0);
                break;
            }
        }
    }
    \crmeb\services\HttpService::postRequest($callbackUrl, json_encode([
        'uid' => (int)$orderInfo['uid'],
        'memberShipId' => $shipId,
        'orderId' => (string)$orderInfo['order_id'],
        'payPrice' => (float)($orderInfo['pay_price'] ?? 0),
    ], JSON_UNESCAPED_UNICODE), [
        'Content-Type: application/json',
        'X-Internal-Token: ' . (string)env('SHUNWEI_INTERNAL_TOKEN', ''),
    ]);
} catch (\Throwable $e) {
    \think\facade\Log::error('shunwei membership callback failed: ' . $e->getMessage());
}
```

## crmeb/.env 新增

```
SHUNWEI_API_URL=http://127.0.0.1:8787
SHUNWEI_INTERNAL_TOKEN=与 shunwei-api/.env 一致
```

## shunwei-api/.env 新增

```
SHUNWEI_INTERNAL_TOKEN=local-dev-internal-token
```

## 本地测试（无需 CRMEB 钩子）

```bash
curl -X POST http://127.0.0.1:8787/api/internal/membership/pay-callback \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: local-dev-internal-token" \
  -d '{"uid":3,"memberShipId":6,"orderId":"hy-test-002"}'
```

## 小程序方案 C（无需改 PHP）

用户微信支付会员成功后，小程序主动调用：

```
POST /api/membership/claim-gift
{ "tierCode":"SW199", "channel":"wechat_pay", "refId":"<OtherOrder.order_id>" }
```

幂等：同一 refId 重复调用不会重复发积分。
