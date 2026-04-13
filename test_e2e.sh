#!/usr/bin/env bash
export PATH="$PATH:/c/Program Files/nodejs"
BASE="http://localhost:5000"
PASS=0; FAIL=0

check() {
  local label="$1"
  local result="$2"
  local expect="$3"
  if echo "$result" | grep -q "$expect"; then
    echo "  PASS  $label"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $label"
    echo "        got: $(echo $result | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

echo "========================================"
echo " FULL END-TO-END TEST SUITE"
echo "========================================"

echo ""
echo "-- AUTH --"
R=$(curl -s -X POST $BASE/auth/admin-login -H "Content-Type: application/json" -d '{"email":"admin@aesthetiq.com","password":"admin123"}')
check "Admin login success" "$R" '"success":true'
check "Admin login returns token" "$R" '"token"'
check "Admin login returns role=admin" "$R" '"role":"admin"'

R=$(curl -s -X POST $BASE/auth/admin-login -H "Content-Type: application/json" -d '{"email":"x","password":"y"}')
check "Admin login 401 on bad creds" "$R" '"success":false'

R=$(curl -s -X POST $BASE/auth/admin-login -H "Content-Type: application/json" -d '{"email":"admin@aesthetiq.com"}')
check "Admin login 400 on missing password" "$R" '"error"'

R=$(curl -s -X POST $BASE/auth/doctor-login -H "Content-Type: application/json" -d '{"email":"doctor@aesthetiq.com","password":"doctor123"}')
check "Doctor login success" "$R" '"success":true'
check "Doctor login returns role=doctor" "$R" '"role":"doctor"'

R=$(curl -s -X POST $BASE/auth/doctor-login -H "Content-Type: application/json" -d '{"email":"bad","password":"bad"}')
check "Doctor login 401 on bad creds" "$R" '"success":false'

echo ""
echo "-- ADMIN: doctors CRUD --"
R=$(curl -s $BASE/admin/doctors)
check "GET /admin/doctors returns success" "$R" '"success":true'
check "GET /admin/doctors has doctors array" "$R" '"doctors"'

R=$(curl -s -X POST $BASE/admin/doctors/create -H "Content-Type: application/json" \
  -d '{"name":"Dr. E2E Test","email":"e2e@aesthetiq.com","specialty":"Testing"}')
check "Create doctor success" "$R" '"success":true'
check "Create doctor returns id" "$R" '"id"'
NEWID=$(echo $R | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

R=$(curl -s -X POST $BASE/admin/doctors/create -H "Content-Type: application/json" \
  -d '{"name":"Dr. E2E Test","email":"e2e@aesthetiq.com","specialty":"Testing"}')
check "Create doctor duplicate email 409" "$R" '"error":"A doctor with this email already exists"'

R=$(curl -s -X POST $BASE/admin/doctors/create -H "Content-Type: application/json" \
  -d '{"name":"No Email"}')
check "Create doctor missing fields 400" "$R" '"error"'

R=$(curl -s $BASE/admin/doctors)
check "New doctor appears in list" "$R" 'e2e@aesthetiq.com'

R=$(curl -s -X PATCH $BASE/admin/doctors/$NEWID/status -H "Content-Type: application/json" -d '{"status":"suspended"}')
check "PATCH status suspended" "$R" '"status":"suspended"'

R=$(curl -s -X PATCH $BASE/admin/doctors/$NEWID/status -H "Content-Type: application/json" -d '{"status":"active"}')
check "PATCH status active" "$R" '"status":"active"'

R=$(curl -s -X PATCH $BASE/admin/doctors/$NEWID/status -H "Content-Type: application/json" -d '{"status":"INVALID"}')
check "PATCH status invalid value 400" "$R" '"error"'

R=$(curl -s -X PATCH $BASE/admin/doctors/doctor-FAKE/status -H "Content-Type: application/json" -d '{"status":"active"}')
check "PATCH status doctor not found 404" "$R" '"error":"Doctor not found"'

echo ""
echo "-- DOCTOR: patients + treatments --"
R=$(curl -s $BASE/doctor/patients)
check "GET /doctor/patients success" "$R" '"success":true'
check "GET /doctor/patients has patients array" "$R" '"patients"'
check "activeTreatments count present" "$R" '"activeTreatments"'

R=$(curl -s -X POST $BASE/doctor/treatments/create -H "Content-Type: application/json" \
  -d '{"patientId":"patient-003","treatments":["Oxygen Facial","Dermaplaning"],"sessionsTotal":4,"notes":"Test plan"}')
check "Create treatment success" "$R" '"success":true'
check "Treatment status is pending_patient_approval" "$R" '"status":"pending_patient_approval"'
check "Treatment has doctorName" "$R" '"doctorName"'

R=$(curl -s -X POST $BASE/doctor/treatments/create -H "Content-Type: application/json" \
  -d '{"patientId":"patient-NONE","treatments":["Hydrafacial"]}')
check "Create treatment unknown patient 404" "$R" '"error":"Patient not found"'

R=$(curl -s -X POST $BASE/doctor/treatments/create -H "Content-Type: application/json" \
  -d '{"patientId":"patient-001","treatments":[]}')
check "Create treatment empty treatments 400" "$R" '"error"'

R=$(curl -s -X POST $BASE/doctor/treatments/create -H "Content-Type: application/json" \
  -d '{"treatments":["Hydrafacial"]}')
check "Create treatment missing patientId 400" "$R" '"error"'

echo ""
echo "-- PATIENT: treatments visibility --"
R=$(curl -s "$BASE/patient/treatments?patientId=patient-003")
check "Patient-003 sees plan after doctor creates it" "$R" 'Oxygen Facial'
check "Patient plan has status field" "$R" '"status"'

NO_PRICE=$(echo $R | grep -c '"platformFee"')
check "Patient view has no platformFee" "$NO_PRICE" "0"

NO_EARN=$(echo $R | grep -c '"doctorEarning"')
check "Patient view has no doctorEarning" "$NO_EARN" "0"

R=$(curl -s "$BASE/patient/treatments?patientId=patient-001")
check "Patient-001 sees existing plans" "$R" 'Hydrafacial'

R=$(curl -s "$BASE/patient/treatments?status=completed")
check "Status filter works" "$R" '"completed"'

R=$(curl -s "$BASE/patient/treatments?patientId=patient-NONE")
check "Unknown patient returns empty array" "$R" '"total":0'

echo ""
echo "-- AI ROUTES --"
R=$(curl -s -X POST $BASE/ai/analyze -H "Content-Type: application/json" \
  -d '{"imageUrl":"https://example.com/face.jpg"}')
check "AI analyze with imageUrl returns suggestions" "$R" '"suggestions"'
NO_PRICE=$(echo $R | grep -c '"price"')
check "AI analyze no price data" "$NO_PRICE" "0"

R=$(curl -s -X POST $BASE/ai/analyze -H "Content-Type: application/json" \
  -d '{"scanResults":{"acne":"mild"}}')
check "AI analyze with scanResults returns suggestions" "$R" '"suggestions"'

R=$(curl -s -X POST $BASE/ai/analyze -H "Content-Type: application/json" -d '{}')
check "AI analyze empty body 400" "$R" '"error"'

R=$(curl -s -X POST $BASE/ai/simulate -H "Content-Type: application/json" \
  -d '{"imageUrl":"https://example.com/face.jpg"}')
check "AI simulate returns analysis" "$R" '"analysis"'
check "AI simulate returns disclaimer" "$R" '"disclaimer"'
check "AI simulate before/after structure" "$R" '"before"'
NO_PRICE=$(echo $R | grep -c '"price"')
check "AI simulate no price data" "$NO_PRICE" "0"

R=$(curl -s -X POST $BASE/ai/simulate -H "Content-Type: application/json" -d '{}')
check "AI simulate missing imageUrl 400" "$R" '"error":"imageUrl is required"'

R=$(curl -s -X POST $BASE/ai/simulate -H "Content-Type: application/json" -d '{"imageUrl":"not-a-url"}')
check "AI simulate invalid URL 400" "$R" '"error":"Invalid imageUrl"'

echo ""
echo "-- EXISTING ROUTES (regression check) --"
R=$(curl -s $BASE/dental/treatments)
check "GET /dental/treatments still works" "$R" '"catalogue"'

R=$(curl -s "$BASE/api/treatments?domain=facial")
check "GET /api/treatments?domain=facial still works" "$R" '"success":true'

R=$(curl -s "$BASE/api/treatments?domain=dental")
check "GET /api/treatments?domain=dental still works" "$R" '"success":true'

R=$(curl -s "$BASE/api/treatments?domain=INVALID")
check "GET /api/treatments invalid domain 400" "$R" '"success":false'

R=$(curl -s $BASE/nonexistent-route)
check "404 for unknown routes" "$R" '"error":"Route not found"'

echo ""
echo "----------------------------------------"
echo " RESULTS: $PASS passed, $FAIL failed"
echo "----------------------------------------"
