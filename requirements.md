# 要件定義書：HubSpotフォーム送信・kintone連携カスタムアプリ

## 1. 目的

HubSpotでフォーム送信が発生した際に、その内容をリアルタイムで検知し、kintoneの指定アプリへレコードとして自動登録する。これにより、Make等の外部ツールへの依存を減らし、セキュアかつ低レイテンシな独自連携基盤をHeroku上に構築する。

## 2. システム構成

* **プラットフォーム**: Heroku
* **ランタイム**: Node.js (v18以降を推奨)
* **データベース**: Heroku Postgres (OAuthトークン管理および実行ログ用)
* **外部連携**:
* HubSpot Webhooks API v3 (トリガー)
* HubSpot Forms API v1 (データ詳細取得)
* kintone REST API (データ登録)



## 3. 業務フロー

1. **エンドユーザー**: HubSpotフォームを送信。
2. **HubSpot**: 送信イベントを検知し、HerokuのWebhookエンドポイントへ通知を送信。
3. **Herokuアプリ**:
* Webhook署名検証を行い、正当なリクエストであることを確認。
* `submissionId` をもとに **Forms API v1** を実行し、回答詳細を取得。
* 必要に応じて **CRM Objects API v3** を実行し、紐付くコンタクト情報を補完。


4. **kintone**: Herokuアプリから送られたデータを、フィールドマッピングに基づき新規レコードとして登録。

## 4. 機能要件

### 4.1 HubSpot Webhook受信機能

* **購読イベント**: `form_submission.v2`。
* **セキュリティ**: リクエストヘッダー `X-HubSpot-Signature` を用いた署名検証の実装。
* **レスポンス**: Webhook受信後、即座に `200 OK` を返却する非同期設計。

### 4.2 データ取得・変換機能

* **詳細データ取得**: `GET /form-integrations/v1/submissions/forms/{formGuid}` を使用し、ユーザーの回答内容（`values` 配列）を取得。
* **マッピング処理**: HubSpotの内部プロパティ名とkintoneのフィールドコードを紐付けるマッピングテーブルの実装。
* **データクレンジング**: チェックボックス等の複数選択項目（`;` 区切り）をkintoneの配列形式へ変換。

### 4.3 kintone連携機能

* **レコード作成**: `POST /k/v1/record.json` を使用。
* **エラーハンドリング**: APIリミット超過やネットワークエラー時のリトライ処理。

## 5. 取得データ項目定義（Forms API v1 準拠）

以下の項目をHubSpotから取得し、kintoneへ連携する。

| 項目名 | HubSpot APIパス/物理名 | 備考 |
| --- | --- | --- |
| 送信日時 | `submittedAt` | タイムスタンプ変換が必要 |
| フォームID | `formId` | 連携元の特定に使用 |
| 回答内容 | `values` (array) | 各入力項目の物理名と値 |
| コンタクトID | `vid` | HubSpot上の顧客識別子 |
| ページURL | `pageUrl` | どのページから送信されたか |
| トークン | `hutk` | クッキー情報（行動履歴紐付け用） |

## 6. 非機能要件

* **スケーラビリティ**: 大量送信時に備え、Heroku Redisを利用したジョブキューイングの検討。
* **保守性**: 各種APIキー、トークン類はHerokuの環境変数（Config Vars）で管理し、ソースコードに直接記述しない。
* **拡張性**: 複数フォームへの対応。
