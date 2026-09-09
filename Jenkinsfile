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
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
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
                bat "node runner.js --env %Environment% --role %Role% --browser %Browser% --tags \"%Tags%\""
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
