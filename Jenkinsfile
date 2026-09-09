pipeline {
    agent any

    parameters {
        choice(name: 'Environment', choices: ['QA', 'Staging', 'Production'], description: 'Target environment')
        choice(name: 'Role', choices: ['Admin', 'Tenant'], description: 'Login role / user type')
        choice(name: 'Browser', choices: ['chrome', 'chromium', 'firefox', 'webkit'], description: 'Browser to run against')
        string(name: 'Tags', defaultValue: 'smoke', description: 'Tag expression, e.g. "smoke", "smoke and login", "regression"')
    }

    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        // Jenkins agents normally run as a service with no interactive desktop session,
        // so a headed browser launch fails/hangs there - always run headless in CI.
        HEADLESS = 'true'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Validate parameters') {
            steps {
                script {
                    // Environment/Role/Browser are fixed `choice` params, so they can't carry
                    // arbitrary text. Tags is a free-text `string` param that gets substituted
                    // into a `bat` (cmd.exe) command below - cmd.exe expands %VAR% before it
                    // parses for "&"/"|"/"^" etc, even inside quotes, so an unvalidated value
                    // could inject extra commands. Only allow safe tag-expression syntax.
                    if (!(params.Tags ==~ /[A-Za-z0-9_ \t()]*/)) {
                        error("Tags parameter contains characters that aren't allowed in a tag expression: ${params.Tags}")
                    }
                }
            }
        }

        stage('Install dependencies') {
            steps {
                bat 'npm ci'
                bat 'npx playwright install --with-deps'
            }
        }

        stage('Run tests') {
            steps {
                bat "node runner.js --env %Environment% --role %Role% --browser %Browser% --tags \"${params.Tags}\""
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'reports/**, allure-results/**, reports.zip', allowEmptyArchive: true

            // Requires the "Allure Jenkins Plugin" to be installed.
            // If it's not installed, comment this block out or remove it.
            script {
                if (fileExists('allure-results')) {
                    allure includeProperties: false, results: [[path: 'allure-results']]
                }
            }
        }
    }
}
