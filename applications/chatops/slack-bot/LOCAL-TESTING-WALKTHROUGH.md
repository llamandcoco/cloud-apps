# Local Testing Complete Walkthrough

## 테스트 레벨별 가이드

### 레벨 1: 단위 테스트 (Unit Tests) - **가장 빠름**

```bash
cd cloud-apps/applications/chatops/slack-bot

# 모든 단위 테스트 실행
npm test

# 특정 파일 테스트
npm test -- router.test.ts
npm test -- slack-verify.test.ts

# 커버리지 리포트 생성
npm run test:coverage
```

**테스트 내용:**
- ✅ Router 서명 검증 (유효/무효)
- ✅ Slack 서명 생성 및 검증
- ✅ 타임스탬프 재생 공격 방지
- ✅ Echo 워커 메시지 처리
- ✅ 실패 처리 (재시도)

**예상 시간:** < 5초

---

### 레벨 2: 통합 테스트 (Integration Tests) - **LocalStack 필요**

#### 2-1. LocalStack 시작

```bash
# LocalStack 백그라운드 시작
docker-compose -f docker-compose.local.yml up -d

# 상태 확인
docker-compose -f docker-compose.local.yml ps

# 로그 확인 (필요시)
docker-compose -f docker-compose.local.yml logs -f localstack
```

#### 2-2. 통합 테스트 실행

```bash
cd cloud-apps/applications/chatops/slack-bot

# 통합 테스트 (Router → EventBridge + Worker flow)
npm run test:integration

# 특정 스이트만 테스트
npm run test:integration -- router-eventbridge.test.ts
npm run test:integration -- worker-flow.test.ts
```

**테스트 내용:**
- ✅ Router가 EventBridge에 이벤트 발행
- ✅ 재생 공격 방지 검증
- ✅ Worker가 SQS에서 메시지 수신
- ✅ Slack API 호출 (axios mock)
- ✅ 실패 처리 및 재시도

**예상 시간:** 10-15초

#### 2-3. LocalStack 리소스 확인

```bash
# EventBridge 버스 확인
aws --endpoint-url=http://localhost:4566 events list-event-buses

# SQS 큐 확인
aws --endpoint-url=http://localhost:4566 sqs list-queues

# SSM 파라미터 확인 (시크릿)
aws --endpoint-url=http://localhost:4566 ssm get-parameter \
  --name /laco/local/aws/secrets/slack/signing-secret \
  --with-decryption
```

---

### 레벨 3: 수동 엔드투엔드 테스트 (Manual E2E) - **가장 현실적**

#### 3-1. 로컬 서버 모드 (ngrok + Slack 앱 연동)

```bash
cd cloud-apps/applications/chatops/slack-bot

# LocalStack 시작 (위와 동일)
docker-compose -f docker-compose.local.yml up -d

# 터미널 1: 로컬 서버 시작
npm run dev

# 터미널 2: ngrok으로 공개 URL 생성
ngrok http 3000

# 터미널 3: Slack 앱 설정
# 1. https://api.slack.com/apps에서 앱 선택
# 2. Slash Commands → /echo → Request URL에 ngrok URL 붙여넣기:
#    https://YOUR-NGROK-URL.ngrok.io/slack/commands
# 3. 저장

# 이제 Slack 워크스페이스에서 테스트:
/echo hello world
```

**검증 포인트:**
- ✅ Slack에서 즉시 응답 받음 ("Processing your `/echo` command...")
- ✅ 2초 후 async 메시지 도착
- ✅ CloudWatch 로그에서 각 단계 확인

#### 3-2. 실제 AWS 배포된 엔드포인트 테스트

```bash
# 환경 설정
export SLACK_SIGNING_SECRET='xoxb_your_actual_signing_secret'
export API_ENDPOINT='https://api-id.execute-api.region.amazonaws.com/stage/slack/commands'

# 테스트 스크립트 실행
./scripts/test-e2e.sh "$API_ENDPOINT" /echo "Production test"

# 또는 직접 curl (헤더 생성 스크립트 사용)
TS_NODE_PROJECT=tsconfig.json \
SLACK_SIGNING_SECRET="$SLACK_SIGNING_SECRET" \
ts-node scripts/generate-slack-headers.ts "command=/echo&text=hello&response_url=https://hooks.slack.com/test" > /tmp/headers.txt

curl -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  $(cat /tmp/headers.txt) \
  -d "command=/echo&text=hello&response_url=https://hooks.slack.com/test&user_id=U123&user_name=testuser&channel_id=C123&channel_name=general&team_id=T123&team_domain=test&trigger_id=trigger123"
```

#### 3-3. Slack API 직접 테스트

```bash
# 봇 토큰으로 채널에 메시지 발송 테스트
export SLACK_BOT_TOKEN='xoxb_your_bot_token'

ts-node scripts/test-slack-post.ts "#test-channel" "Hello from local bot"
```

---

## 문제 해결

### LocalStack 시작 안 됨
```bash
# Docker 상태 확인
docker ps

# 재시작
docker-compose -f docker-compose.local.yml down
docker-compose -f docker-compose.local.yml up -d

# 로그 확인
docker-compose -f docker-compose.local.yml logs localstack
```

### npm test 실패
```bash
# 캐시 삭제
npm run test -- --clearCache

# 재설치
rm -rf node_modules package-lock.json
npm install

# TypeScript 컴파일 확인
npm run type-check
```

### ngrok 연결 안 됨
```bash
# ngrok 재시작
ngrok http 3000

# Slack 앱에서 새 URL로 업데이트
# https://api.slack.com/apps → Slash Commands → Request URL

# 새 로컬 서버 시작
npm run dev
```

### Slack 서명 검증 실패
```bash
# 1. .env.local에서 SLACK_SIGNING_SECRET 확인
cat .env.local

# 2. Slack 앱의 Signing Secret과 일치하는지 확인
# https://api.slack.com/apps → App Credentials

# 3. 테스트 요청의 타임스탐프가 현재 시간과 5분 이내인지 확인
date +%s
```

---

## 권장 테스트 순서

```
1️⃣  단위 테스트로 개발 검증
    npm test

2️⃣  LocalStack으로 통합 테스트
    npm run test:integration

3️⃣  로컬 서버 + ngrok으로 E2E 테스트
    npm run dev + ngrok + Slack 앱

4️⃣  AWS 배포 후 실제 엔드포인트 테스트
    ./scripts/test-e2e.sh https://api.execute-api...
```

---

## 각 레벨별 커버리지

| 레벨 | 속도 | 범위 | 의존성 |
|------|------|------|--------|
| 단위 | ⚡⚡⚡ | 로직만 | 없음 |
| 통합 | ⚡⚡ | Router + EventBridge + Worker | LocalStack |
| 로컬 E2E | ⚡ | 전체 (실제 Slack 앱) | LocalStack + ngrok |
| AWS E2E | 🐢 | 전체 (프로덕션 like) | AWS |

**결론: 개발 중 단위 + 통합 테스트로 충분. 배포 전 실제 Slack 앱과 로컬 E2E 한 번 테스트.**
