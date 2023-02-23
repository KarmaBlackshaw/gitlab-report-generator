const axios = require('axios')
const moment = require('moment')
const dedent = require('dedent')
const _ = require('lodash')
const Promise = require('bluebird')
const fs = Promise.promisifyAll(require('fs-extra'))

const { pathExists } = require('./helpers')

const { PROJECT_FILE_PATH } = require('./constants')
const ACCESS_TOKEN = process.env.ACCESS_TOKEN
module.exports = {
  async getProjects ({
    reset = false
  } = {}) {
    if (!reset) {
      const projectExists = await pathExists(PROJECT_FILE_PATH)

      if (projectExists) {
        const projects = await fs.readFileAsync(PROJECT_FILE_PATH, 'utf8')

        return JSON.parse(projects)
      }
    }

    const {
      data: groups
    } = await axios.get('https://gitlab.com/api/v4/groups/', {
      params: {
        top_level_only: false,
        access_token: ACCESS_TOKEN
      }
    })

    const allGroups = await (async () => {
      const response = await Promise.map(groups, async group => {
        try {
          const { data } = await axios.get(`https://gitlab.com/api/v4/groups/${group.id}/subgroups`, {
            params: {
              access_token: ACCESS_TOKEN,
              all_available: true
            }
          })

          return data.map(subgroup => ({
            id: subgroup.id,
            name: subgroup.name,
            web_url: subgroup.web_url
          }))
        } catch (error) {
          console.log(error)
          throw error
        }
      }, {
        concurrency: 3
      })

      const mainGroups = groups.map(group => ({
        id: group.id,
        name: group.name,
        web_url: group.web_url
      }))

      return _.flatten(response)
        .concat(mainGroups)
    })()

    const promises = allGroups.flatMap(group => {
      return [
        axios.get(`https://gitlab.com/api/v4/groups/${group.id}/projects`, {
          params: {
            access_token: ACCESS_TOKEN,
            include_subgroups: true
          }
        }),
        axios.get(`https://gitlab.com/api/v4/groups/${group.id}/projects`, {
          params: {
            access_token: ACCESS_TOKEN
          }
        })
      ]
    })

    const list = Promise.map(promises, ({ data: projects }) => {
      return projects.map(project => ({
        id: project.id,
        path_with_namespace: project.path_with_namespace
      }))
    }, {
      concurrency: 5
    })

    const projects = _.uniqBy(list, 'id')

    await fs.writeFileAsync(PROJECT_FILE_PATH, JSON.stringify(projects, null, 2))

    return projects
  },

  async generateReport ({
    email,
    include_merge: includeMerge,
    limit = Infinity
  }) {
    try {
      const projects = await fs.readJSON(PROJECT_FILE_PATH)

      let totalCommits = 0

      await Promise.map(
        projects,
        async project => {
          const {
            data: commits
          } = await axios.get(`https://gitlab.com/api/v4/projects/${project.id}/repository/commits`, {
            params: {
              access_token: ACCESS_TOKEN,
              since: moment().startOf('day'),
              all: true
            }
          })

          project.commits = commits
            .filter(commit => {
              if (!includeMerge && commit.title.includes('Merge branch')) {
                return false
              }

              if (commit.committer_email !== email) {
                return false
              }

              totalCommits += 1

              if (totalCommits > limit) {
                return false
              }

              return true
            })
            .map(commit => ({
              id: commit.id,
              created_at: commit.created_at,
              committer_email: commit.committer_email,
              web_url: commit.web_url,
              title: commit.title.includes('Merge branch')
                ? 'Code review'
                : commit.title
            }))
        },
        { concurrency: 10 }
      )

      const projectsWithCommits = projects
        .filter(x => x.commits.length)

      let report = ''
      projectsWithCommits.forEach(project => {
        const text = `Updates for *${project.path_with_namespace}*`
        const commits = project.commits.map(commit => {
          return ` - [${commit.title}](${commit.web_url})`
        }).join('\n')

        report += dedent(`
          \n${text}
          ${commits}\n
        `)

        report += '\n\n'
      })

      return dedent(report)
    } catch (error) {
      console.log(error)
      throw error
    }
  }
}
